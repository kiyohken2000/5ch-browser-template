// 検証プローブ: N23 (曖昧 NG) をゼロショット NLI 分類器 (2 ラベルの分類ヘッドつき GGUF) で
// 実装できるかの調査。結果は docs/BRUSHUP_PLAN.md [N23] を参照。
//
// 対象モデル: MoritzLaurer/bge-m3-zeroshot-v2.0 (MIT, XLMRobertaForSequenceClassification,
//   id2label = {0: entailment, 1: not_entailment}, XLM-R large 568M, 多言語, 8k ctx)
//   https://huggingface.co/MoritzLaurer/bge-m3-zeroshot-v2.0
//   GGUF が公開されていないので llama.cpp の convert_hf_to_gguf.py で自前変換する
//   (conversion/bert.py が XLMRobertaForSequenceClassification に対応しており、
//    config.json の id2label がそのまま `bert.classifier.output_labels` になる)。
//
// probe_rerank_ng.rs (n_cls_out=1 の reranker) との違い:
//   - n_cls_out=2。embeddings_seq_ith() が [entailment, not_entailment] の素 logit 2 本を返すので
//     2 値 softmax で P(entailment) を作る。llama.cpp 側は RANK プーリングで
//     CLS -> cls -> tanh -> cls_out を通す (softmax は qwen3 系のみなので掛からない)
//   - ペアの向きが逆。reranker は (クエリ, 文書) だが NLI は (前提, 仮説) で、
//     前提 = レス本文、仮説 = NG ルールを平叙文にしたもの
//
// cargo の自動検出 (examples/) の外に置いてあり、通常のビルド・CI には含まれない。
// 実行するときは examples/ にコピーしてビルドする:
//   cp scripts/probe_nli_ng.rs crates/core-ai/examples/nli_probe.rs
//   CARGO_TARGET_DIR=C:/t LIBCLANG_PATH="C:/Program Files/LLVM/bin" cargo build --release -p core-ai --example nli_probe
//   C:/t/release/examples/nli_probe.exe <model.gguf> <cpu|gpu> [sanity|single|decomp|all]
//   rm crates/core-ai/examples/nli_probe.rs
//
//   sanity … 本来の用途 (明らかに含意する / しない日本語ペア) で分離するかの裏取り
//   single … NG ルール 1 本をそのまま仮説にする (probe_ng_llm.rs と同じ 12 件)
//   decomp … ルールを単一述語 2 本に分解して AND を取る。複合条件の偽陽性が消えるかを見る
//   len    … レス本文の長さごとのレイテンシ。1 スレ (1000 レス) の見積もりに使う
use std::num::NonZeroU32;
use std::time::Instant;

use llama_cpp_2::context::params::{LlamaContextParams, LlamaPoolingType};
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::token::LlamaToken;

// probe_ng_llm.rs / probe_rerank_ng.rs と同一のケース。A = ルールに該当する
const CASES: &[(&str, &str)] = &[
    ("自民に投票する奴は全員脳みそ腐ってるだろ。マジで死ねよ", "A"),
    ("野党支持者ってほんと知恵遅れしかいないな。国に帰れ", "A"),
    ("今日の首相の会見、増税の話は結局先送りか。財源どうするんだろうね", "B"),
    ("このゲームのアプデ神すぎる。ガチャ渋いのは相変わらずだけど", "B"),
    ("お前みたいなバカがいるからスレが荒れるんだよ。消えろ", "B"),
    ("立憲の議員がまた失言してて笑った。まあいつものことか", "B"),
    ("パヨクは日本から出ていけ。存在自体が害悪", "A"),
    ("ネトウヨって現実見えてないゴミばっかだな。恥ずかしくないの？", "A"),
    ("選挙行ってきた。投票率上がるといいね", "B"),
    ("昨日のラーメン屋、味は普通だったけど店員の態度が最悪だった", "B"),
    (">>12 それ去年のニュースだぞ。ソース確認してから書けよ", "B"),
    ("岸田も石破もどいつもこいつも無能。支持してる連中は頭おかしい", "A"),
];

// single モード: ルール全体を 1 つの仮説にする。言い回しの差を見るため複数用意する
const SINGLE_HYPOTHESES: &[(&str, &str)] = &[
    ("plain", "この書き込みは政治の話題で他人を罵倒している。"),
    ("about", "この文章は、政治について他人を罵倒する内容である。"),
    ("en", "This text insults other people while talking about politics."),
];

// decomp モード: 単一述語に分解する。(名前, 仮説)
const DECOMP_HYPOTHESES: &[(&str, &str)] = &[
    ("政治", "この書き込みは政治の話題である。"),
    ("罵倒", "この書き込みは他人を罵倒している。"),
];

// 分解した述語ごとの正解ラベル (政治か / 罵倒か)。AND を取ると CASES の期待ラベルと一致する
const DECOMP_TRUTH: &[(bool, bool)] = &[
    (true, true),
    (true, true),
    (true, false),
    (false, false),
    (false, true),
    (true, false),
    (true, true),
    (true, true),
    (true, false),
    (false, true),
    (false, false),
    (true, true),
];

/// XLM-R 本来のペア形式 `<s> premise </s></s> hypothesis </s>`。
fn build_pair(model: &LlamaModel, premise: &str, hypothesis: &str) -> Vec<LlamaToken> {
    let bos = model.token_bos();
    let eos = model.token_eos();
    let p = model.str_to_token(premise, AddBos::Never).expect("tok premise");
    let h = model
        .str_to_token(hypothesis, AddBos::Never)
        .expect("tok hypothesis");
    let mut out = Vec::with_capacity(p.len() + h.len() + 4);
    out.push(bos);
    out.extend_from_slice(&p);
    out.push(eos);
    out.push(eos);
    out.extend_from_slice(&h);
    out.push(eos);
    out
}

/// 1 ペア分の P(entailment)。2 本の素 logit を 2 値 softmax に通す。
fn score_pair(ctx: &mut LlamaContext, batch: &mut LlamaBatch, tokens: &[LlamaToken]) -> (f32, f32, f32) {
    ctx.clear_kv_cache();
    batch.clear();
    for (i, &t) in tokens.iter().enumerate() {
        batch
            .add(t, i as i32, &[0], i + 1 == tokens.len())
            .expect("batch add");
    }
    ctx.decode(batch).expect("decode");
    let out = ctx.embeddings_seq_ith(0).expect("embeddings_seq_ith");
    assert!(
        out.len() >= 2,
        "n_cls_out={} — 2 ラベルの分類ヘッドが載っていない GGUF を読んでいる",
        out.len()
    );
    let (a, b) = (out[0], out[1]);
    let m = a.max(b);
    let (ea, eb) = ((a - m).exp(), (b - m).exp());
    (ea / (ea + eb), a, b)
}

fn run_sanity(model: &LlamaModel, ctx: &mut LlamaContext, batch: &mut LlamaBatch) {
    println!("\n== sanity: 明らかに含意する / しない日本語ペア ==");
    for (premise, hypothesis, expect) in [
        ("日本の首都は東京です。人口はおよそ1400万人です。", "この文章は日本の都市について述べている。", "entail"),
        ("日本の首都は東京です。人口はおよそ1400万人です。", "この文章は料理のレシピである。", "not"),
        ("昨日のラーメン屋、味は普通だったけど店員の態度が最悪だった", "この書き込みは飲食店について不満を述べている。", "entail"),
        ("昨日のラーメン屋、味は普通だったけど店員の態度が最悪だった", "この書き込みは選挙について述べている。", "not"),
    ] {
        let toks = build_pair(model, premise, hypothesis);
        let t = Instant::now();
        let (p, la, lb) = score_pair(ctx, batch, &toks);
        println!(
            "  exp={expect:6} P(entail)={p:.4} logits=[{la:+.3}, {lb:+.3}] {:.0}ms n_tok={} | {hypothesis}",
            t.elapsed().as_secs_f64() * 1000.0,
            toks.len()
        );
    }
}

fn run_single(model: &LlamaModel, ctx: &mut LlamaContext, batch: &mut LlamaBatch) {
    for (name, hypothesis) in SINGLE_HYPOTHESES {
        println!("\n== single / {name} :: {hypothesis} ==");
        let mut correct = 0;
        let mut total_ms = 0.0;
        let mut total_tok = 0usize;
        let mut probs: Vec<f32> = Vec::new();
        for (body, expect) in CASES {
            let toks = build_pair(model, body, hypothesis);
            let t = Instant::now();
            let (p, la, lb) = score_pair(ctx, batch, &toks);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            total_ms += ms;
            total_tok += toks.len();
            probs.push(p);
            let pred = if p >= 0.5 { "A" } else { "B" };
            if pred == *expect {
                correct += 1;
            }
            println!(
                "{} exp={expect} P={p:.4} logits=[{la:+.3}, {lb:+.3}] {ms:.0}ms n_tok={} | {}",
                if pred == *expect { "ok " } else { "NG " },
                toks.len(),
                body.chars().take(26).collect::<String>()
            );
        }
        let mut sorted = probs.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        println!(
            "single/{name}: {correct}/{} correct @0.5, avg {:.1}ms ({:.0} tok/件), P range {:.4}..{:.4}",
            CASES.len(),
            total_ms / CASES.len() as f64,
            total_tok as f64 / CASES.len() as f64,
            sorted[0],
            sorted[sorted.len() - 1]
        );
        if probs.iter().all(|s| s.to_bits() == probs[0].to_bits()) {
            println!("WARN: all probs bit-identical — stale embeddings? check the output flag / kv clear");
        }
    }
}

fn run_decomp(model: &LlamaModel, ctx: &mut LlamaContext, batch: &mut LlamaBatch) {
    println!("\n== decomp: 単一述語 2 本の AND ==");
    for (name, hypothesis) in DECOMP_HYPOTHESES {
        println!("  仮説[{name}] {hypothesis}");
    }
    let mut per_pred_correct = [0usize; 2];
    let mut and_correct = 0;
    let mut total_ms = 0.0;
    for (idx, (body, expect)) in CASES.iter().enumerate() {
        let mut ps = [0.0f32; 2];
        for (i, (_, hypothesis)) in DECOMP_HYPOTHESES.iter().enumerate() {
            let toks = build_pair(model, body, hypothesis);
            let t = Instant::now();
            let (p, _, _) = score_pair(ctx, batch, &toks);
            total_ms += t.elapsed().as_secs_f64() * 1000.0;
            ps[i] = p;
        }
        let truth = DECOMP_TRUTH[idx];
        if (ps[0] >= 0.5) == truth.0 {
            per_pred_correct[0] += 1;
        }
        if (ps[1] >= 0.5) == truth.1 {
            per_pred_correct[1] += 1;
        }
        // AND は min を取る (両方が成り立つ確率の下限として素直な近似)
        let and_p = ps[0].min(ps[1]);
        let pred = if and_p >= 0.5 { "A" } else { "B" };
        if pred == *expect {
            and_correct += 1;
        }
        println!(
            "{} exp={expect} 政治={:.4}({}) 罵倒={:.4}({}) AND={and_p:.4} | {}",
            if pred == *expect { "ok " } else { "NG " },
            ps[0],
            if truth.0 { "Y" } else { "n" },
            ps[1],
            if truth.1 { "Y" } else { "n" },
            body.chars().take(24).collect::<String>()
        );
    }
    println!(
        "decomp: AND {and_correct}/{} correct @0.5, 政治単独 {}/{}, 罵倒単独 {}/{}, avg {:.1}ms/件 (2 判定ぶん)",
        CASES.len(),
        per_pred_correct[0],
        CASES.len(),
        per_pred_correct[1],
        CASES.len(),
        total_ms / CASES.len() as f64
    );
}

/// 実スレ 1 本を丸ごと判定して偽陽性を数える。TSV (レス番号 \t 本文) を食わせる。
/// 生成は `scratchpad/dump_thread.py` (Ember の SQLite キャッシュから取り出す)。
fn run_file(model: &LlamaModel, ctx: &mut LlamaContext, batch: &mut LlamaBatch, path: &str, hypothesis: &str) {
    let text = std::fs::read_to_string(path).expect("read tsv");
    let rows: Vec<(u32, String)> = text
        .lines()
        .filter_map(|l| {
            let (no, body) = l.split_once('\t')?;
            let body = body.trim();
            if body.is_empty() {
                return None;
            }
            // 長すぎるレスは先頭だけ見る (n_ctx 2048 に収めるため)
            let body: String = body.chars().take(700).collect();
            Some((no.parse().ok()?, body))
        })
        .collect();
    println!("\n== file: {path} / {} 件 ==", rows.len());
    println!("  仮説: {hypothesis}");
    let mut scored: Vec<(f32, u32, &str)> = Vec::with_capacity(rows.len());
    let mut hist = [0usize; 10];
    let t0 = Instant::now();
    for (no, body) in &rows {
        let toks = build_pair(model, body, hypothesis);
        let (p, _, _) = score_pair(ctx, batch, &toks);
        hist[((p * 10.0) as usize).min(9)] += 1;
        scored.push((p, *no, body));
    }
    let total = t0.elapsed().as_secs_f64();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    // 全件のスコアを書き出す。層化サンプリングして正解ラベルを付ける評価セットの材料。
    let dump = format!("{path}.scores.tsv");
    match std::fs::write(
        &dump,
        scored
            .iter()
            .map(|(p, no, body)| format!("{no}\t{p:.6}\t{body}\n"))
            .collect::<String>(),
    ) {
        Ok(()) => println!("  scores -> {dump}"),
        Err(e) => println!("  WARN: スコアの書き出しに失敗 ({e})"),
    }
    println!(
        "  {:.1} 秒 / {} 件 = {:.1}ms/件",
        total,
        rows.len(),
        total * 1000.0 / rows.len() as f64
    );
    print!("  P の分布:");
    for (i, n) in hist.iter().enumerate() {
        print!(" {:.1}-{:.1}:{n}", i as f32 / 10.0, (i + 1) as f32 / 10.0);
    }
    println!();
    for th in [0.9f32, 0.8, 0.7, 0.5] {
        println!(
            "  P>={th:.1}: {} 件 ({:.1}%)",
            scored.iter().filter(|(p, _, _)| *p >= th).count(),
            scored.iter().filter(|(p, _, _)| *p >= th).count() as f32 * 100.0 / rows.len() as f32
        );
    }
    println!("  -- 上位 25 件 (目視で偽陽性を数える) --");
    for (p, no, body) in scored.iter().take(25) {
        println!("  P={p:.4} >>{no} {}", body.chars().take(70).collect::<String>());
    }
    println!("  -- 0.45〜0.55 の境界 (最大 10 件) --");
    for (p, no, body) in scored.iter().filter(|(p, _, _)| (0.45..=0.55).contains(p)).take(10) {
        println!("  P={p:.4} >>{no} {}", body.chars().take(70).collect::<String>());
    }
}

/// レス本文の長さごとのレイテンシ。1 スレぶん (1000 レス) の見積もりに使う。
fn run_len(model: &LlamaModel, ctx: &mut LlamaContext, batch: &mut LlamaBatch) {
    println!("\n== len: 本文の長さ別レイテンシ ==");
    let unit = "この法案については賛否が分かれていて、党内でも意見がまとまっていないらしい。";
    let hypothesis = SINGLE_HYPOTHESES[1].1;
    for reps in [1usize, 3, 8, 16] {
        let body = unit.repeat(reps);
        let toks = build_pair(model, &body, hypothesis);
        // 1 回目はキャッシュの立ち上がりを含むので捨てて 3 回の平均を取る
        let _ = score_pair(ctx, batch, &toks);
        let t = Instant::now();
        for _ in 0..3 {
            let _ = score_pair(ctx, batch, &toks);
        }
        let ms = t.elapsed().as_secs_f64() * 1000.0 / 3.0;
        println!(
            "  n_tok={:4} {ms:6.1}ms/件  {:5.0} tok/s  1000 レス = {:5.1} 秒",
            toks.len(),
            toks.len() as f64 / (ms / 1000.0),
            ms,
        );
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = &args[1];
    let gpu = args.get(2).map(String::as_str).unwrap_or("cpu") == "gpu";
    let mode = args.get(3).map(String::as_str).unwrap_or("all");

    let backend = LlamaBackend::init().expect("backend");
    let mut mp = LlamaModelParams::default().with_n_gpu_layers(if gpu { 999 } else { 0 });
    if !gpu {
        mp = mp.with_devices(&[]).expect("devices");
    }
    let t0 = Instant::now();
    let model = LlamaModel::load_from_file(&backend, model_path, &mp).expect("load model");
    println!(
        "model loaded in {:?} (gpu={gpu}, mode={mode}) n_cls_out={} n_ctx_train={}",
        t0.elapsed(),
        model.n_cls_out(),
        model.n_ctx_train()
    );
    println!(
        "bos={} eos={} sep={}",
        model.token_bos().0,
        model.token_eos().0,
        model.token_sep().0
    );

    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(2048))
        .with_n_batch(2048)
        // RANK プーリングは 1 シーケンスを 1 回で encode するので n_ubatch も伸ばす
        // (既定 512 のままだと長いレスで n_ubatch >= n_tokens の assert に落ちる)
        .with_n_ubatch(2048)
        .with_embeddings(true)
        .with_pooling_type(LlamaPoolingType::Rank);
    let mut ctx = model.new_context(&backend, ctx_params).expect("ctx");
    let mut batch = LlamaBatch::new(2048, 1);
    println!("context created, n_ctx={}", ctx.n_ctx());

    if matches!(mode, "sanity" | "all") {
        run_sanity(&model, &mut ctx, &mut batch);
    }
    if matches!(mode, "single" | "all") {
        run_single(&model, &mut ctx, &mut batch);
    }
    if matches!(mode, "decomp" | "all") {
        run_decomp(&model, &mut ctx, &mut batch);
    }
    if matches!(mode, "len" | "all") {
        run_len(&model, &mut ctx, &mut batch);
    }
    if mode == "file" {
        let path = args.get(4).map(String::as_str).expect("usage: … file <tsv> [仮説]");
        let hypothesis = args.get(5).map(String::as_str).unwrap_or(SINGLE_HYPOTHESES[1].1);
        run_file(&model, &mut ctx, &mut batch, path, hypothesis);
    }
}
