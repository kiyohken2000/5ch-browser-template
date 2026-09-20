// 検証プローブ: N23 (曖昧 NG) を SemIf 方式 (ラベル logit 直読み) で実装できるかの調査。
// 結果は docs/BRUSHUP_PLAN.md [N23] を参照。
//
// cargo の自動検出 (examples/) の外に置いてあり、通常のビルド・CI には含まれない。
// 実行するときは examples/ にコピーしてビルドする:
//   cp scripts/probe_ng_llm.rs crates/core-ai/examples/ng_probe.rs
//   CARGO_TARGET_DIR=C:/t LIBCLANG_PATH="C:/Program Files/LLVM/bin" cargo build --release -p core-ai --example ng_probe
//   C:/t/release/examples/ng_probe.exe <model.gguf> <template: gemma4|gemma|qwen|lfm2> <cpu|gpu> [swap] [system]
//   rm crates/core-ai/examples/ng_probe.rs
//
//   swap   … 選択肢の意味を入れ替える (A=該当しない, B=該当する)。ラベル位置バイアスの確認用
//   system … 指示文を system ターンに出す (Ember の aiSystemTurn 相当。qwen / lfm2 のみ)
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::token::LlamaToken;

static SWAP: AtomicBool = AtomicBool::new(false);
static SYSTEM_TURN: AtomicBool = AtomicBool::new(false);
const INSTRUCTION: &str = "あなたは掲示板のレスを判定する分類器です。以下のルールにレスが該当するかを判定してください。";

fn system_turn(t: &str) -> String {
    if !SYSTEM_TURN.load(Ordering::Relaxed) {
        return String::new();
    }
    match t {
        "qwen" | "lfm2" => format!("<|im_start|>system\n{INSTRUCTION}<|im_end|>\n"),
        _ => String::new(),
    }
}
fn wrap_user(t: &str, c: &str) -> String {
    match t {
        "qwen" | "lfm2" => format!("<|im_start|>user\n{c}<|im_end|>\n"),
        "gemma4" => format!("<|turn>user\n{c}<turn|>\n"),
        _ => format!("<start_of_turn>user\n{c}<end_of_turn>\n"),
    }
}
fn open_assistant(t: &str) -> String {
    match t {
        "qwen" => "<|im_start|>assistant\n<think>\n\n</think>\n\n".to_string(),
        "lfm2" => "<|im_start|>assistant\n".to_string(),
        "gemma4" => "<|turn>model\n".to_string(),
        _ => "<start_of_turn>model\n".to_string(),
    }
}

const RULE: &str = "政治の話題で他人を罵倒している";

// (本文, 期待ラベル)
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

fn build_content(rule: &str, body: &str) -> String {
    let (oa, ob) = if SWAP.load(Ordering::Relaxed) {
        ("ルールに該当しない", "ルールに該当する")
    } else {
        ("ルールに該当する", "ルールに該当しない")
    };
    let head = if SYSTEM_TURN.load(Ordering::Relaxed) { "" } else { INSTRUCTION };
    format!(
        "{head}\n\n\
ルール:\n{rule}\n\n\
レス:\n{body}\n\n\
選択肢:\nA. {oa}\nB. {ob}\n\n\
選択肢の記号を A か B の 1 文字だけで答えてください。"
    )
}

fn decode_all(ctx: &mut LlamaContext, batch: &mut LlamaBatch, tokens: &[LlamaToken], start: usize) {
    for (ci, chunk) in tokens.chunks(256).enumerate() {
        batch.clear();
        let last_chunk = (ci + 1) * 256 >= tokens.len();
        for (i, &t) in chunk.iter().enumerate() {
            let pos = (start + ci * 256 + i) as i32;
            let is_last = last_chunk && i + 1 == chunk.len();
            batch.add(t, pos, &[0], is_last).expect("batch add");
        }
        ctx.decode(batch).expect("decode");
    }
}

fn piece(model: &LlamaModel, t: LlamaToken) -> String {
    let b = model.token_to_piece_bytes(t, 64, true, None).unwrap_or_default();
    String::from_utf8_lossy(&b).replace('\n', "\\n")
}

fn report(model: &LlamaModel, ctx: &LlamaContext, a: LlamaToken, b: LlamaToken) -> (f32, usize, String) {
    let logits = ctx.get_logits();
    let la = logits[a.0 as usize];
    let lb = logits[b.0 as usize];
    let m = la.max(lb);
    let pa = (la - m).exp() / ((la - m).exp() + (lb - m).exp());
    let mut idx: Vec<usize> = (0..logits.len()).collect();
    idx.sort_by(|&x, &y| logits[y].partial_cmp(&logits[x]).unwrap_or(std::cmp::Ordering::Equal));
    let rank_best = idx.iter().position(|&i| i == a.0 as usize || i == b.0 as usize).unwrap_or(usize::MAX);
    let top5: Vec<String> = idx.iter().take(5).map(|&i| format!("{:?}", piece(model, LlamaToken(i as i32)))).collect();
    (pa, rank_best, top5.join(" "))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = &args[1];
    let template = args.get(2).map(String::as_str).unwrap_or("gemma4");
    let gpu = args.get(3).map(String::as_str).unwrap_or("cpu") == "gpu";
    let swap = args.iter().any(|a| a == "swap");
    SWAP.store(swap, Ordering::Relaxed);
    let system_turn_on = args.iter().any(|a| a == "system");
    SYSTEM_TURN.store(system_turn_on, Ordering::Relaxed);

    let backend = LlamaBackend::init().expect("backend");
    let mut mp = LlamaModelParams::default().with_n_gpu_layers(if gpu { 999 } else { 0 });
    if !gpu {
        mp = mp.with_devices(&[]).expect("devices");
    }
    let t0 = Instant::now();
    let model = LlamaModel::load_from_file(&backend, model_path, &mp).expect("load model");
    println!("model loaded in {:?} (gpu={gpu}, template={template}, swap={swap}, system_turn={system_turn_on})", t0.elapsed());

    // --- 1. ラベルの単一トークン性 ---
    for s in ["A", "B", "はい", "いいえ", " A", "A."] {
        let toks = model.str_to_token(s, AddBos::Never).expect("tok");
        let ids: Vec<String> = toks.iter().map(|t| format!("{}={:?}", t.0, piece(&model, *t))).collect();
        println!("tokenize {s:?}: {} token(s): {}", toks.len(), ids.join(", "));
    }
    let opener = open_assistant(template);
    let prefix_full = system_turn(template) + &wrap_user(template, &build_content(RULE, "x")) + &opener;
    let tok_prefix = model.str_to_token(&prefix_full, AddBos::Always).expect("tok");
    let tok_prefix_a = model.str_to_token(&(prefix_full.clone() + "A"), AddBos::Always).expect("tok");
    let tok_a = model.str_to_token("A", AddBos::Never).expect("tok");
    let tok_b = model.str_to_token("B", AddBos::Never).expect("tok");
    let consistent = tok_prefix_a.len() == tok_prefix.len() + 1
        && tok_prefix_a[..tok_prefix.len()] == tok_prefix[..]
        && tok_prefix_a[tok_prefix.len()] == tok_a[0];
    println!("prefix+A tokenization consistent (opener tokens unchanged, A appended as single token): {consistent}");
    let a = tok_a[0];
    let b = tok_b[0];
    // swap 時は「A=該当しない」なので P(該当) = 1 - P(A)
    let p_match = |pa: f32| if swap { 1.0 - pa } else { pa };

    // --- 2. レスごとに新規コンテキスト (現行 complete_streaming 相当) ---
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(2048))
        .with_n_batch(2048);
    let mut correct = 0;
    let mut total_ms = 0.0;
    println!("\n== mode A: fresh context per response ==");
    for (body, expect) in CASES {
        let prompt = system_turn(template) + &wrap_user(template, &build_content(RULE, body)) + &opener;
        let toks = model.str_to_token(&prompt, AddBos::Always).expect("tok");
        let t = Instant::now();
        let mut ctx = model.new_context(&backend, ctx_params.clone()).expect("ctx");
        let mut batch = LlamaBatch::new(512, 1);
        decode_all(&mut ctx, &mut batch, &toks, 0);
        let (pa, rank, top5) = report(&model, &ctx, a, b);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        total_ms += ms;
        let pm = p_match(pa);
        let pred = if pm >= 0.5 { "A" } else { "B" };
        if pred == *expect { correct += 1; }
        println!("{} exp={expect} P(該当)={pm:.3} rank(A|B)={rank} {ms:.0}ms n_tok={} top5={top5} | {}", if pred == *expect { "ok " } else { "NG " }, toks.len(), body.chars().take(24).collect::<String>());
    }
    println!("mode A: {correct}/{} correct, avg {:.0}ms", CASES.len(), total_ms / CASES.len() as f64);

    // --- 3. 共通プレフィックスを KV キャッシュして本文だけ decode ---
    println!("\n== mode B: shared prefix KV cache + rewind ==");
    let head = build_content(RULE, "\u{0}");
    let split = head.find('\u{0}').expect("marker");
    let (head_a, head_b) = head.split_at(split);
    let head_b = &head_b[1..];
    let user_open = wrap_user(template, "").split('\n').next().unwrap_or("").to_string() + "\n";
    let prefix = system_turn(template) + &user_open + head_a;
    let tok_prefix = model.str_to_token(&prefix, AddBos::Always).expect("tok");
    let mut ctx = model.new_context(&backend, ctx_params.clone()).expect("ctx");
    let mut batch = LlamaBatch::new(512, 1);
    let t = Instant::now();
    decode_all(&mut ctx, &mut batch, &tok_prefix, 0);
    println!("prefix decoded: {} tokens in {:?}", tok_prefix.len(), t.elapsed());
    let user_close = wrap_user(template, "\u{0}");
    let close_idx = user_close.find('\u{0}').expect("marker");
    let user_close = &user_close[close_idx + 1..];
    let mut correct = 0;
    let mut total_ms = 0.0;
    let mut rewind_failed = 0;
    for (body, expect) in CASES {
        let suffix = format!("{body}{head_b}{user_close}{opener}");
        let tok_suffix = model.str_to_token(&suffix, AddBos::Never).expect("tok");
        let t = Instant::now();
        decode_all(&mut ctx, &mut batch, &tok_suffix, tok_prefix.len());
        let (pa, rank, top5) = report(&model, &ctx, a, b);
        let rewound = ctx
            .clear_kv_cache_seq(Some(0), Some(tok_prefix.len() as u32), None)
            .expect("rewind");
        if !rewound {
            // 再帰型 (conv / SSM) メモリは部分削除不可 → 全消去してプレフィックスを再 decode
            rewind_failed += 1;
            ctx.clear_kv_cache();
            decode_all(&mut ctx, &mut batch, &tok_prefix, 0);
        }
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        total_ms += ms;
        let pm = p_match(pa);
        let pred = if pm >= 0.5 { "A" } else { "B" };
        if pred == *expect { correct += 1; }
        println!("{} exp={expect} P(該当)={pm:.3} rank(A|B)={rank} {ms:.0}ms n_tok={} top5={top5} | {}", if pred == *expect { "ok " } else { "NG " }, tok_suffix.len(), body.chars().take(24).collect::<String>());
    }
    println!("mode B: {correct}/{} correct, avg {:.0}ms, partial seq_rm unsupported x{rewind_failed} (fell back to full re-decode)", CASES.len(), total_ms / CASES.len() as f64);
}
