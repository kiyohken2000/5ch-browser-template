// 検証プローブ: N23 (曖昧 NG) をクロスエンコーダ (reranker) GGUF で実装できるかの調査。
// 結果は docs/BRUSHUP_PLAN.md [N23]「別方式の検証: クロスエンコーダ (reranker) GGUF」を参照。
//
// 対象モデル: gpustack/bge-reranker-v2-m3-GGUF (arch=bert, tokenizer=t5/UGM, n_cls_out=1)
//   https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF
//
// cargo の自動検出 (examples/) の外に置いてあり、通常のビルド・CI には含まれない。
// 実行するときは examples/ にコピーしてビルドする:
//   cp scripts/probe_rerank_ng.rs crates/core-ai/examples/rerank_probe.rs
//   CARGO_TARGET_DIR=C:/t LIBCLANG_PATH="C:/Program Files/LLVM/bin" cargo build --release -p core-ai --example rerank_probe
//   C:/t/release/examples/rerank_probe.exe <model.gguf> <cpu|gpu> [sanity|pair|topic|all]
//   rm crates/core-ai/examples/rerank_probe.rs
//
//   sanity … 本来の検索用途 (質問 -> 答えを含む文書) でスコアが正に振れるかの裏取り
//   pair   … NG ルールをクエリ、レス本文を文書にして判定できるか (probe_ng_llm.rs と同じ 12 件)
//   topic  … 話題 (トピック) 単独のクエリで順位が分離するか。ROC-AUC も出す
use std::num::NonZeroU32;
use std::time::Instant;

use llama_cpp_2::context::params::{LlamaContextParams, LlamaPoolingType};
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::token::LlamaToken;

const RULE: &str = "政治の話題で他人を罵倒している";

// probe_ng_llm.rs と同一のケース。A = ルールに該当する
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

// topic モード用。bool は「政治の話題か」(罵倒かどうかは問わない)
const TOPIC_CASES: &[(&str, bool)] = &[
    ("自民に投票する奴は全員脳みそ腐ってるだろ。マジで死ねよ", true),
    ("野党支持者ってほんと知恵遅れしかいないな。国に帰れ", true),
    ("今日の首相の会見、増税の話は結局先送りか。財源どうするんだろうね", true),
    ("このゲームのアプデ神すぎる。ガチャ渋いのは相変わらずだけど", false),
    ("お前みたいなバカがいるからスレが荒れるんだよ。消えろ", false),
    ("立憲の議員がまた失言してて笑った。まあいつものことか", true),
    ("パヨクは日本から出ていけ。存在自体が害悪", true),
    ("ネトウヨって現実見えてないゴミばっかだな。恥ずかしくないの？", true),
    ("選挙行ってきた。投票率上がるといいね", true),
    ("昨日のラーメン屋、味は普通だったけど店員の態度が最悪だった", false),
    (">>12 それ去年のニュースだぞ。ソース確認してから書けよ", false),
    ("岸田も石破もどいつもこいつも無能。支持してる連中は頭おかしい", true),
    ("ワクチン打ったら熱出たわ。二日くらい寝込んだ", false),
    ("新しいiPhone高すぎて買えない。型落ちでいいや", false),
];

// ルール文の言い回しによる差を見る
const QUERY_FORMS: &[(&str, &str)] = &[
    ("raw", "{rule}"),
    ("cond", "次の条件に当てはまる書き込み: {rule}"),
    ("q", "この書き込みは「{rule}」に該当しますか？"),
];

const TOPIC_QUERIES: &[&str] = &[
    "政治",
    "政治の話題",
    "選挙や政党についての話",
    "ゲームの話題",
    "食べ物の話題",
];

/// セパレータの並べ方。llama.cpp の `format_prompt_rerank` は `add_sep_token` が
/// 無いと Sep1 相当になるが、XLM-R 本来のペア形式は Sep2 (`</s></s>`)。
/// bge-reranker-v2-m3 の GGUF には `tokenizer.ggml.add_sep_token` が無いので、
/// llama-server 経由では Sep1 になる。core-ai に直接実装すれば Sep2 を出せる。
#[derive(Clone, Copy)]
enum SepStyle {
    Sep1,
    Sep2,
}

fn build_pair(model: &LlamaModel, query: &str, doc: &str, style: SepStyle) -> Vec<LlamaToken> {
    let bos = model.token_bos();
    let eos = model.token_eos();
    let q = model.str_to_token(query, AddBos::Never).expect("tok query");
    let d = model.str_to_token(doc, AddBos::Never).expect("tok doc");
    let mut out = Vec::with_capacity(q.len() + d.len() + 4);
    out.push(bos);
    out.extend_from_slice(&q);
    out.push(eos);
    if matches!(style, SepStyle::Sep2) {
        out.push(eos);
    }
    out.extend_from_slice(&d);
    out.push(eos);
    out
}

/// RANK プーリングのスコアを 1 ペア分取る。返り値は素の logit (sigmoid 前)。
fn score_pair(ctx: &mut LlamaContext, batch: &mut LlamaBatch, tokens: &[LlamaToken]) -> f32 {
    ctx.clear_kv_cache();
    batch.clear();
    for (i, &t) in tokens.iter().enumerate() {
        batch
            .add(t, i as i32, &[0], i + 1 == tokens.len())
            .expect("batch add");
    }
    ctx.decode(batch).expect("decode");
    ctx.embeddings_seq_ith(0).expect("embeddings_seq_ith")[0]
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

fn run_sanity(model: &LlamaModel, ctx: &mut LlamaContext, batch: &mut LlamaBatch) {
    println!("\n== sanity: 本来の検索用途 (質問 -> 答えを含む文書) ==");
    for (q, d) in [
        ("日本の首都はどこですか", "日本の首都は東京です。人口はおよそ1400万人です。"),
        ("日本の首都はどこですか", "昨日のラーメン屋、味は普通だったけど店員の態度が最悪だった"),
        ("What is the capital of Japan?", "The capital of Japan is Tokyo."),
    ] {
        let toks = build_pair(model, q, d, SepStyle::Sep2);
        let raw = score_pair(ctx, batch, &toks);
        println!(
            "  raw={raw:+7.3} sigmoid={:.4} q={q} | d={}",
            sigmoid(raw),
            d.chars().take(24).collect::<String>()
        );
    }
}

fn run_pair(model: &LlamaModel, ctx: &mut LlamaContext, batch: &mut LlamaBatch) {
    for (sep_name, style) in [("sep1", SepStyle::Sep1), ("sep2", SepStyle::Sep2)] {
        for (qname, form) in QUERY_FORMS {
            let query = form.replace("{rule}", RULE);
            println!("\n== pair {sep_name} / query={qname} :: {query} ==");
            let mut correct = 0;
            let mut total_ms = 0.0;
            let mut scores: Vec<f32> = Vec::new();
            for (body, expect) in CASES {
                let toks = build_pair(model, &query, body, style);
                let t = Instant::now();
                let raw = score_pair(ctx, batch, &toks);
                let ms = t.elapsed().as_secs_f64() * 1000.0;
                total_ms += ms;
                let p = sigmoid(raw);
                scores.push(p);
                let pred = if p >= 0.5 { "A" } else { "B" };
                if pred == *expect {
                    correct += 1;
                }
                println!(
                    "{} exp={expect} raw={raw:+.3} sigmoid={p:.4} {ms:.0}ms n_tok={} | {}",
                    if pred == *expect { "ok " } else { "NG " },
                    toks.len(),
                    body.chars().take(26).collect::<String>()
                );
            }
            let mut sorted = scores.clone();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            println!(
                "{sep_name}/{qname}: {correct}/{} correct @0.5, avg {:.1}ms, score range {:.4}..{:.4}",
                CASES.len(),
                total_ms / CASES.len() as f64,
                sorted[0],
                sorted[sorted.len() - 1]
            );
            // 全件が bit 単位で同じなら出力フラグ / KV クリア漏れで古い値を読んでいる疑い
            if scores.iter().all(|s| s.to_bits() == scores[0].to_bits()) {
                println!("WARN: all scores bit-identical — stale embeddings? check the output flag / kv clear");
            }
        }
    }
}

fn run_topic(model: &LlamaModel, ctx: &mut LlamaContext, batch: &mut LlamaBatch) {
    for q in TOPIC_QUERIES {
        println!("\n== topic query: {q} ==");
        let mut rows: Vec<(f32, bool, &str)> = Vec::new();
        let mut total_ms = 0.0;
        for (body, is_pol) in TOPIC_CASES {
            let toks = build_pair(model, q, body, SepStyle::Sep2);
            let t = Instant::now();
            let raw = score_pair(ctx, batch, &toks);
            total_ms += t.elapsed().as_secs_f64() * 1000.0;
            rows.push((raw, *is_pol, body));
        }
        rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        for (raw, is_pol, body) in &rows {
            println!(
                "  raw={raw:+7.3} pol={} | {}",
                if *is_pol { "Y" } else { "n" },
                body.chars().take(26).collect::<String>()
            );
        }
        // 政治ラベルを正解としたときの ROC-AUC (順位ベース)。0.5 = 判別力なし
        let pos: Vec<f32> = rows.iter().filter(|r| r.1).map(|r| r.0).collect();
        let neg: Vec<f32> = rows.iter().filter(|r| !r.1).map(|r| r.0).collect();
        let mut wins = 0.0;
        for p in &pos {
            for n in &neg {
                wins += if p > n {
                    1.0
                } else if (p - n).abs() < f32::EPSILON {
                    0.5
                } else {
                    0.0
                };
            }
        }
        println!(
            "  AUC(政治ラベル)={:.3}  avg {:.1}ms",
            wins / (pos.len() * neg.len()) as f32,
            total_ms / TOPIC_CASES.len() as f64
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
    match model.chat_template(Some("rerank")) {
        Ok(t) => println!("rerank chat template present: {t:?}"),
        Err(e) => println!("rerank chat template: none ({e})"),
    }

    // RANK プーリングは embeddings=true とセットで指定する。
    // embeddings_seq_ith() は RANK のとき float[n_cls_out] を返す。
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(2048))
        .with_n_batch(2048)
        .with_embeddings(true)
        .with_pooling_type(LlamaPoolingType::Rank);
    let mut ctx = model.new_context(&backend, ctx_params).expect("ctx");
    let mut batch = LlamaBatch::new(2048, 1);
    println!("context created, n_ctx={}", ctx.n_ctx());

    if matches!(mode, "sanity" | "all") {
        run_sanity(&model, &mut ctx, &mut batch);
    }
    if matches!(mode, "pair" | "all") {
        run_pair(&model, &mut ctx, &mut batch);
    }
    if matches!(mode, "topic" | "all") {
        run_topic(&model, &mut ctx, &mut batch);
    }
}
