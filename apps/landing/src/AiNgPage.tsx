import { useEffect, useRef, useState } from "react";

import appIcon from "./assets/images/icon.png";
import shotInstall from "./assets/images/ng-ai-install.png";
import shotEntry from "./assets/images/ng-ai-entry.png";
import shotPanel from "./assets/images/ng-ai-panel.png";
import shotCollapsed from "./assets/images/ng-ai-collapsed.png";
import shotTips from "./assets/images/ng-ai-tips.png";

const GITHUB_URL = "https://github.com/kiyohken2000/5ch-browser-template";
const ISSUES_URL = "https://github.com/kiyohken2000/5ch-browser-template/issues";
const BLOG_URL = "https://capsaicin.site";
const X_URL = "https://x.com/votepurchase";
const MODEL_URL = "https://huggingface.co/votepurchase/bge-m3-zeroshot-v2.0-GGUF";
const BASE_MODEL_URL = "https://huggingface.co/MoritzLaurer/bge-m3-zeroshot-v2.0";

type ThemeKey = "light" | "dark";

function readInitialColorScheme(): ThemeKey {
  if (typeof document !== "undefined") {
    const current = document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") return current;
  }
  return "dark";
}

export default function AiNgPage() {
  const [colorScheme, setColorScheme] = useState<ThemeKey>(readInitialColorScheme);
  const [zoomed, setZoomed] = useState<{ src: string; alt: string } | null>(null);
  const zoomCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = colorScheme;
    try {
      localStorage.setItem("ember.landing.theme", colorScheme);
    } catch (error) {
      console.warn("theme save failed", error);
    }
  }, [colorScheme]);

  useEffect(() => {
    if (!zoomed) return;
    zoomCloseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  const shot = (src: string, alt: string, caption: string) => (
    <figure className="doc-shot">
      <button type="button" className="doc-shot-button" onClick={() => setZoomed({ src, alt })}>
        <img src={src} alt={alt} loading="lazy" />
      </button>
      <figcaption>{caption}</figcaption>
    </figure>
  );

  return (
    <>
      <header className="site-nav">
        <div className="nav-inner">
          <a className="nav-brand" href="/">
            <img src={appIcon} alt="" className="nav-logo" />
            <span>Ember</span>
          </a>
          <nav className="nav-links">
            <a href="/#features">機能</a>
            <a href="/#install">インストール</a>
            <a href="/#download">ダウンロード</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}
              aria-label={colorScheme === "dark" ? "ライトテーマに切り替え" : "ダークテーマに切り替え"}
            >
              {colorScheme === "dark" ? "☀" : "☾"}
            </button>
          </nav>
        </div>
      </header>

      <main className="page doc-page" id="top">
        <section className="section doc-hero">
          <p className="kicker">曖昧NG</p>
          <h1>
            文字列では書けない条件で、
            <br />
            レスを隠す。
          </h1>
          <p className="lead">
            「政治の話題で他人を罵倒している」のような自然文のルールでレスを判定します。
            判定はあなたの端末の中だけで行われ、レスの内容が外部に送信されることはありません。
          </p>
          <div className="doc-badges">
            <span className="doc-badge">追加モデル 0.42 GB</span>
            <span className="doc-badge">1 レス約 60 ミリ秒 (CPU)</span>
            <span className="doc-badge">外部送信なし</span>
            <span className="doc-badge">文章生成はしない</span>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <p className="kicker">Usage</p>
            <h2>使い方</h2>
          </div>

          <div className="doc-step">
            <h3><span className="doc-step-no">1</span> 判定器を入れる</h3>
            <p>
              ファイルメニューの「AI 設定」を開き、<strong>「曖昧NG (AIルール)」</strong>の
              「判定器をダウンロード」を押します。0.42 GB の専用モデルが 1 つ増えるだけで、
              要約や翻訳に使うモデルとは別枠です。入れるまで曖昧NGのメニューは表示されません。
            </p>
            {shot(shotInstall, "AI 設定の曖昧NGセクション", "AI 設定 →「曖昧NG (AIルール)」から導入します")}
          </div>

          <div className="doc-step">
            <h3><span className="doc-step-no">2</span> パネルを開く</h3>
            <p>
              導入すると、編集メニューに「AIルール (曖昧NG)」が現れます。
              NGフィルタのパネルからも開けます。
            </p>
            {shot(shotEntry, "NGフィルタパネルのAIルールタブ", "NGフィルタパネルの「AIルール」からも開けます")}
          </div>

          <div className="doc-step">
            <h3><span className="doc-step-no">3</span> ルールを作る</h3>
            <p>
              条件は<strong>1 行にひとつずつ</strong>書きます。たとえば「政治の話題で他人を罵倒している」なら、
              「この書き込みは政治の話題である。」と「この書き込みは他人を罵倒している。」の 2 行に分けます。
              すべてを満たしたレスだけが対象になります。1 文にまとめるより精度がはっきり上がります
              (後述)。
            </p>
            <p>
              うまく書けないときは、<strong>隠したいレスの番号を指定して候補を作らせる</strong>こともできます。
              候補には「指定した例を何件拾えたか」「このスレの約何 % に当たるか」が並ぶので、
              広すぎる候補や何も拾わない候補をその場で捨てられます。
            </p>
            {shot(shotPanel, "AIルールパネル", "しきい値・自動判定・候補生成・ルール一覧")}
          </div>

          <div className="doc-step">
            <h3><span className="doc-step-no">4</span> 判定する</h3>
            <p>
              レス欄の下にある<strong>「曖昧NG」ボタン</strong>で、開いているスレを判定します。
              スレを開いたときに自動で判定させることもできます (既定はオフ)。
              判定中も操作は止まらず、進捗が出て途中で中止できます。
            </p>
            <p>
              条件に当たったレスは<strong>1 行に畳まれ、理由が表示されます</strong>。
              あぼーんとは違い、<strong>「表示」を押せばその場で元に戻せます</strong>。
              何が隠れたのか分からなくなることはありません。
            </p>
            {shot(shotCollapsed, "曖昧NGで畳まれたレス", "畳まれたレスは理由つきで 1 行に。クリックで戻せます")}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <p className="kicker">Tips</p>
            <h2>ルールの書き方</h2>
          </div>
          <p className="lead">
            実際のスレ 1002 レスに正解を付けて測った結果です。同じことを言っているつもりの文でも、
            書き方で結果がはっきり変わります。
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>書き方</th>
                  <th>隠れた数</th>
                  <th>そのうち正しかった割合</th>
                </tr>
              </thead>
              <tbody>
                <tr className="doc-row-good">
                  <td>
                    <strong>2 行に分ける</strong>
                    <br />
                    <span className="muted small">この書き込みは政治の話題である。／この書き込みは他人を罵倒している。</span>
                  </td>
                  <td>32 件</td>
                  <td><strong>81%</strong></td>
                </tr>
                <tr>
                  <td>
                    1 文にまとめる
                    <br />
                    <span className="muted small">この書き込みは政治の話題で他人を罵倒している。</span>
                  </td>
                  <td>101 件</td>
                  <td>46%</td>
                </tr>
                <tr>
                  <td>
                    文末の「。」を省く
                    <br />
                    <span className="muted small">…政治の話題である／…他人を罵倒している</span>
                  </td>
                  <td>25 件</td>
                  <td>76%</td>
                </tr>
                <tr>
                  <td>
                    動作を名詞で書く
                    <br />
                    <span className="muted small">他人を罵倒</span>
                  </td>
                  <td>21 件</td>
                  <td>71%</td>
                </tr>
              </tbody>
            </table>
          </div>
          {shot(
            shotTips,
            "AIルールパネルの書き方のコツ",
            "同じ案内はアプリ内の「書き方のコツ」にも入っています",
          )}
          <ul className="doc-list">
            <li><strong>条件は分けて書く。</strong> 1 文に詰め込むと精度がほぼ半分になります。</li>
            <li><strong>平叙文で、文末の「。」まで書く。</strong> 省くと拾える数が 2 割ほど減ります。</li>
            <li>
              <strong>話題は短くてもかまいません。</strong>「政治の話題」のような言い方で十分です。
              ただし<strong>動作や状態は「〜している。」の完全な文</strong>にしてください。
            </li>
            <li>
              <strong>「感情的」「敵意がある」のような広い言葉は避けます。</strong>
              普通のレスまで巻き込みます。
            </li>
          </ul>
        </section>

        <section className="section">
          <div className="section-head">
            <p className="kicker">Accuracy</p>
            <h2>どのくらい当たるのか</h2>
          </div>
          <p className="lead">
            都合のいい数字だけを出しても仕方がないので、実測をそのまま書きます。
            嫌儲の荒れたスレ 1002 レスに手で正解を付けて測りました。
          </p>
          <div className="doc-metrics">
            <div className="doc-metric">
              <p className="doc-metric-value">81%</p>
              <p className="doc-metric-label">隠れたレスのうち、条件に本当に当てはまっていた割合</p>
            </div>
            <div className="doc-metric">
              <p className="doc-metric-value">26%</p>
              <p className="doc-metric-label">条件に当てはまるレスのうち、実際に隠せた割合</p>
            </div>
            <div className="doc-metric">
              <p className="doc-metric-value">0.2%</p>
              <p className="doc-metric-label">ルールと無関係な話題のスレでの誤爆 (1000 レスあたり 1〜2 件)</p>
            </div>
          </div>
          <p>
            つまり<strong>「全部を消す道具」ではなく「一番ひどいものを畳む道具」</strong>です。
            1000 レスあたり 6 件ほどは、本来当てはまらないレスが隠れます。
            だからこそ既定は復元できる「非表示」で、あぼーんは選べないようにしてあります。
            しきい値を下げれば取りこぼしは減りますが、誤って隠れる数も増えます。
          </p>
        </section>

        <section className="section">
          <div className="section-head">
            <p className="kicker">Architecture</p>
            <h2>仕組み</h2>
          </div>

          <div className="doc-cards">
            <div className="card doc-card">
              <h3>文章を書かないモデル</h3>
              <p>
                使っているのは <a href={BASE_MODEL_URL} target="_blank" rel="noreferrer">bge-m3-zeroshot-v2.0</a>
                （XLM-RoBERTa-large 568M、100 言語以上、MIT）。
                「この文にこの条件が当てはまるか」だけを答える<strong>ゼロショット分類器</strong>で、
                文章生成は一切しません。チャットや要約に使う LLM とは別物です。
              </p>
            </div>
            <div className="card doc-card">
              <h3>判定は 1 回の前向き計算</h3>
              <p>
                レス本文と条件文を組にして 1 回通すだけで、2 つのラベル
                (当てはまる／当てはまらない) のスコアが出ます。
                トークンを 1 つずつ生成しないので、生成モデルに同じことをさせるより
                <strong>20 倍以上速い</strong>です。
              </p>
            </div>
            <div className="card doc-card">
              <h3>既存の推論基盤に同居</h3>
              <p>
                Ember が要約や翻訳に使っている llama.cpp をそのまま使います
                (rank プーリングで分類ヘッドを通す)。
                追加のランタイムはありません。チャット用モデルとは別のスロットに読み込まれるので、
                判定が走ってもチャットのモデルは落ちません。
              </p>
            </div>
            <div className="card doc-card">
              <h3>判定結果は保存されます</h3>
              <p>
                判定した結果は端末内のデータベースに残ります。
                同じスレを開き直しても判定し直さず、<strong>新着レスだけ</strong>を判定します。
                条件文を書き換えたときだけ、そのルールの結果を破棄します。
              </p>
            </div>
            <div className="card doc-card">
              <h3>速度</h3>
              <p>
                CPU で <strong>1 レスあたり条件 1 つにつき約 60 ミリ秒</strong>。
                条件 2 つのルールで 1000 レスのスレを丸ごと判定すると 2 分ほどです。
                判定は裏で走り、10 件ごとに結果が反映されます。
              </p>
            </div>
            <div className="card doc-card">
              <h3>外部に出ません</h3>
              <p>
                モデルは初回にダウンロードしますが、<strong>判定そのものは完全に端末内</strong>で行われます。
                レスの本文も、あなたが書いた条件文も、どこにも送信されません。
                配布している GGUF は <a href={MODEL_URL} target="_blank" rel="noreferrer">Hugging Face</a> で公開しています。
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <p className="kicker">FAQ</p>
            <h2>よくある質問</h2>
          </div>
          <div className="doc-faq">
            <div>
              <h3>チャット用のモデルも必要ですか？</h3>
              <p>
                判定だけなら不要です。判定器 (0.42 GB) だけで動きます。
                「隠したいレスの例からルールの候補を作る」機能を使うときだけ、
                有効化されたチャット用モデルが必要になります。
              </p>
            </div>
            <div>
              <h3>既存のNG機能はどうなりますか？</h3>
              <p>
                これまでのワード・ID・名前によるNGはそのままです。曖昧NGは独立して動き、
                連鎖あぼーんなどにも影響しません。候補から「IDをNG」で通常のNGに登録することもできます。
              </p>
            </div>
            <div>
              <h3>判定が重くて操作できなくなりませんか？</h3>
              <p>
                判定は別スレッドで動き、細かく区切って実行されるので操作は止まりません。
                進捗が出て途中で中止でき、要約や翻訳を実行すると判定は自動的に道を譲ります。
              </p>
            </div>
            <div>
              <h3>どの言語で書けますか？</h3>
              <p>
                モデルは 100 言語以上に対応していますが、
                <strong>レスと同じ言語 (日本語) で条件を書くのが一番精度が出ます</strong>。
                日本語のレスに英語の条件を当てると精度が落ちることを確認しています。
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="card support-card">
            <div>
              <h3>うまく動かない・条件が書けない</h3>
              <p className="lead">
                <a href={ISSUES_URL} target="_blank" rel="noreferrer">GitHub Issues</a> へお知らせください。
                どんな条件を書いて何が起きたかが分かると助かります。
              </p>
              <p className="lead">
                検証の詳細は <a href={`${GITHUB_URL}/blob/main/docs/BRUSHUP_PLAN.md`} target="_blank" rel="noreferrer">docs/BRUSHUP_PLAN.md</a> に、
                測定に使ったスクリプトは <code>scripts/</code> に置いてあります。
              </p>
            </div>
          </div>
        </section>

        <footer className="site-footer">
          <div className="footer-left">
            <img src={appIcon} alt="" className="footer-logo" />
            <div>
              <p className="strong">Ember</p>
              <p className="muted small">5ch.io 専用ブラウザ · Tauri v2 + React</p>
            </div>
          </div>
          <div className="footer-links">
            <a href="/">トップ</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href={X_URL} target="_blank" rel="noreferrer">X</a>
            <a href={BLOG_URL} target="_blank" rel="noreferrer">Blog</a>
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">Issues</a>
          </div>
        </footer>
      </main>

      {zoomed ? (
        <div
          className="image-zoom-overlay"
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-modal="true"
          aria-label={zoomed.alt}
        >
          <button
            type="button"
            ref={zoomCloseRef}
            className="image-zoom-close"
            onClick={() => setZoomed(null)}
            aria-label="拡大表示を閉じる"
          >
            ×
          </button>
          <img className="image-zoom-content" src={zoomed.src} alt={zoomed.alt} />
        </div>
      ) : null}
    </>
  );
}
