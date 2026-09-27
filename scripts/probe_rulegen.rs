// 検証プローブ: 曖昧 NG の述語をローカル LLM に書かせられるかの調査。
// 例レス (TSV: レス番号 \t 本文) を渡すと、共通する特徴を平叙文の述語として出させる。
//
//   cp scripts/probe_rulegen.rs crates/core-ai/examples/rulegen_probe.rs
//   CARGO_TARGET_DIR=C:/t LIBCLANG_PATH="..." cargo build --release -p core-ai --example rulegen_probe
//   C:/t/release/examples/rulegen_probe.exe <model.gguf> <positives.tsv> <v1|v2|v3> [negatives.tsv]
//
//   v1 … 最初の素朴な指示 (複合文を出す / 行数を守らない / 抽象的すぎる、で失敗)
//   v2 … 出力枠を「話題:」「書き方:」に固定し、良い例と悪い例を見せる
//   v3 … v2 に「消したくないレス」の例 (負例) を足す
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use core_ai::{complete_streaming, InferenceBackend};

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

const V1: &str = "あなたは掲示板の書き込みを分類する条件を作る手伝いをします。\n\
以下は、ユーザーが「こういう書き込みを非表示にしたい」と選んだ例です。\n\
これらすべてに当てはまり、それ以外の普通の書き込みには当てはまらない条件を考えてください。\n\
\n\
出力の決まり:\n\
- 「この書き込みは〜である。」または「この書き込みは〜している。」の形の平叙文で書く\n\
- 1 行に 1 つ、2 行か 3 行で出す\n\
- 条件を 1 文に詰め込まず、話題と書き方のように分けて書く\n\
- 説明や前置きは書かない。条件の行だけを出す";

// v1 の失敗を踏まえた版。仕組み (各行が独立に判定される) を説明し、出力枠を固定し、
// 良い例と悪い例を実物で見せる。
const V2: &str = "掲示板の書き込みを隠すための「条件文」を作ります。\n\
\n\
仕組み: 条件文は 1 行ずつ独立に、1 件の書き込みに対して「当てはまるか / 当てはまらないか」を\n\
判定されます。すべての行が当てはまった書き込みだけが隠されます。\n\
だから 1 行にはひとつのことだけを書いてください。\n\
\n\
良い例 (2 行に分かれている):\n\
話題: この書き込みは政治の話題である。\n\
書き方: この書き込みは他人を罵倒している。\n\
\n\
悪い例 (1 行に 2 つ入っているので使えません):\n\
この書き込みは政治の話題で他人を罵倒している。\n\
この書き込みは、特定の立場を過激に擁護し、他者を攻撃する言説である。\n\
\n\
注意:\n\
- 「感情的」「敵意がある」のような広すぎる言葉は、普通の書き込みまで当たるので避ける\n\
- 話題の行には、扱われている話題そのものを短い言葉で入れる\n\
- 例に出てくる国名・人名・団体名などの固有名詞そのものではなく、それを含む一段上の分類で書く\n\
  (例がすべて同じゲームの話でも、そのゲーム名ではなく「ゲームの話題」と書く)\n\
- 書き方の行には、書き手の態度ややり方を入れる。相手が個人でも集団でも当てはまる言い方にする\n\
- 伏字や記号ではなく、実際に判定に使える言葉で書く\n\
- 1 行だけを出す。説明や前置きは書かない";

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model_path = &args[1];
    let positives_path = &args[2];
    let variant = args.get(3).map(String::as_str).unwrap_or("v2");
    let negatives_path = args.get(4).cloned();
    let template = std::env::var("RULEGEN_TEMPLATE").unwrap_or_else(|_| "gemma4".to_string());

    let read_examples = |path: &str, label: &str| -> String {
        let text = std::fs::read_to_string(path).expect("read examples");
        let mut out = String::new();
        for line in text.lines() {
            let Some((no, body)) = line.split_once('\t') else { continue };
            let body: String = body.chars().take(200).collect();
            out.push_str(&format!("{label}{no}: {body}\n"));
        }
        out
    };

    let positives = read_examples(positives_path, "例");
    let instruction = match variant {
        "v1" => V1,
        _ => V2,
    };
    let mut content = format!("{instruction}\n\n隠したい書き込みの例:\n{positives}");
    if variant == "v3" {
        let negatives_path = negatives_path.expect("v3 は負例のファイルが要ります");
        let negatives = read_examples(&negatives_path, "残す");
        content.push_str(&format!(
            "\nこちらは隠したくない書き込みです。これらには当てはまらない条件にしてください:\n{negatives}"
        ));
    }

    println!("=== {variant} / プロンプト {} 文字 ===", content.chars().count());

    // 小さいモデルは指示を復唱して本題に入らないことがある (v2 で実際に起きた)。
    // 答えの書き出しを先に置いて、その続きだけを書かせる。枠ごとに 1 回ずつ呼ぶので、
    // 「1 行に 1 つ」も構造で強制できる。
    for slot in ["話題", "書き方"] {
        let prefill = "この書き込みは";
        let prompt = format!(
            "{}{}{slot}: {prefill}",
            wrap_user(&template, &content),
            open_assistant(&template)
        );
        let cancel = AtomicBool::new(false);
        let mut out = String::new();
        let t = Instant::now();
        match complete_streaming(
            Path::new(model_path),
            &prompt,
            32,
            InferenceBackend::Cpu,
            &cancel,
            |piece| out.push_str(piece),
            |_| {},
        ) {
            Ok(_) => {
                // 最初の行だけを採る。続けて別の行を書き始めても捨てる。
                let first = out.lines().next().unwrap_or("").trim();
                println!("--- {slot} ({:.1} 秒) ---", t.elapsed().as_secs_f64());
                println!("{prefill}{first}");
            }
            Err(e) => println!("--- {slot} 生成失敗: {e} ---"),
        }
    }
}
