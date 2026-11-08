import { useEffect, useRef, useState, type ReactNode } from "react";

import SiteNav from "./SiteNav";
import badgeAppStore from "./assets/images/mobile/appstore.png";
import badgeGooglePlay from "./assets/images/mobile/googleplay.png";
import shotAi from "./assets/images/mobile/ai-settings.jpg";
import shotBoard from "./assets/images/mobile/board.jpg";
import shotCombo from "./assets/images/mobile/combo.jpg";
import shotFonts from "./assets/images/mobile/fonts.jpg";
import shotMenu from "./assets/images/mobile/menu.jpg";
import shotPopup from "./assets/images/mobile/popup.jpg";
import shotSummary from "./assets/images/mobile/summary.jpg";
import shotThread from "./assets/images/mobile/thread.jpg";
import shotTranslate from "./assets/images/mobile/translate.jpg";
import shotXCard from "./assets/images/mobile/xcard.jpg";

const GITHUB_URL = "https://github.com/kiyohken2000/5ch-browser-template";
const SUPPORT_EMAIL = "retwpay@gmail.com";
/** 法的文書の最終更新日。文面を変えたらここも変える */
const LEGAL_UPDATED = "2026年11月8日";
/** 公開されたら入れる。空のあいだはバッジに「準備中」と出す */
const APP_STORE_URL = "";
const GOOGLE_PLAY_URL = "";

type ThemeKey = "light" | "dark";
export type MobilePageKey = "mobile" | "privacy" | "terms" | "support";

function readInitialColorScheme(): ThemeKey {
  if (typeof document !== "undefined") {
    const current = document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") return current;
  }
  return "dark";
}

function PageFrame({ children }: { children: ReactNode }) {
  const [colorScheme, setColorScheme] = useState<ThemeKey>(readInitialColorScheme);

  useEffect(() => {
    document.documentElement.dataset.theme = colorScheme;
    try {
      localStorage.setItem("ember.landing.theme", colorScheme);
    } catch (error) {
      console.warn("theme save failed", error);
    }
  }, [colorScheme]);

  return (
    <>
      <SiteNav
        brandHref="/"
        links={[
          { href: "/", label: "デスクトップ版" },
          { href: "/mobile.html", label: "モバイル版" },
          { href: "/support.html", label: "サポート" },
        ]}
        themeButton={
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}
            aria-label={colorScheme === "dark" ? "ライトテーマに切り替え" : "ダークテーマに切り替え"}
          >
            {colorScheme === "dark" ? "☀" : "☾"}
          </button>
        }
      />
      {children}
      <footer className="site-footer mobile-footer">
        <p className="muted small">
          Ember は非公式のアプリで、5ch.io およびその運営者とは関係がありません。
        </p>
        <div className="footer-links">
          <a href="/mobile.html">モバイル版</a>
          <a href="/privacy.html">プライバシーポリシー</a>
          <a href="/terms.html">利用規約</a>
          <a href="/support.html">サポート</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </footer>
    </>
  );
}

function StoreBadge({ href, src, label }: { href: string; src: string; label: string }) {
  if (href) {
    return (
      <a className="store-badge" href={href} target="_blank" rel="noreferrer">
        <img src={src} alt={`${label} で入手`} />
      </a>
    );
  }
  return (
    <span className="store-badge is-pending">
      <img src={src} alt="" />
      <span className="store-badge-note">{label}: 準備中</span>
    </span>
  );
}

function PhoneShot({ src, alt, eager }: { src: string; alt: string; eager?: boolean }) {
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!zoomed) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomed(false);
    };
    document.body.classList.add("zoom-open");
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("zoom-open");
      previousFocus?.focus();
    };
  }, [zoomed]);

  return (
    <>
      <button
        type="button"
        className="phone phone-button"
        onClick={() => setZoomed(true)}
        aria-label={`${alt}を拡大表示`}
      >
        <img src={src} alt={alt} loading={eager ? undefined : "lazy"} />
      </button>
      {zoomed ? (
        <div
          className="image-zoom-overlay"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
        >
          <button
            type="button"
            ref={closeRef}
            className="image-zoom-close"
            onClick={() => setZoomed(false)}
            aria-label="拡大表示を閉じる"
          >
            ×
          </button>
          <img className="image-zoom-content image-zoom-phone" src={src} alt={alt} />
        </div>
      ) : null}
    </>
  );
}

type Feature = {
  kicker: string;
  title: string;
  body: string;
  points: string[];
  shots: { src: string; alt: string }[];
};

const FEATURES: Feature[] = [
  {
    kicker: "Read",
    title: "読むことに集中できる画面",
    body: "ID の色分け、長文の折りたたみ、横スクロールの AA 表示。読み返した位置はスレごとに覚えていて、開き直してもそこから続きを読めます。",
    points: [
      "監視、お気に入り、最近、書き込み、dat 落ちをホームで切り替え",
      "板ごとの勢い順、絞り込み、新着の印",
      "ピンチで文字サイズを変更。2 本指のジェスチャも割り当てられます",
    ],
    shots: [{ src: shotBoard, alt: "スレッド一覧の画面" }],
  },
  {
    kicker: "Anchor",
    title: "アンカーは、重ねて辿る",
    body: ">> や被アンカーをタップすると、読んでいた場所の上にカードが開きます。話の流れがツリーで分かり、さらにタップすれば何枚でも重なります。外側をタップすれば 1 枚ずつ戻れます。",
    points: [
      "ID ごとの一覧や検索結果も同じカードで表示",
      "カードの中のレスをタップすると、その位置へ移動",
    ],
    shots: [
      { src: shotPopup, alt: "アンカーのカードを重ねて表示した画面" },
      { src: shotMenu, alt: "レスを長押ししたときのメニュー" },
    ],
  },
  {
    kicker: "Media",
    title: "画像も動画も、その場で",
    body: "画像のサムネイル、動画の再生、YouTube、X のポストのカードを本文の下に表示します。スレの画像を一覧にして、まとめて保存することもできます。",
    points: [
      "サムネイルのぼかし、大きい画像はタップで読み込みなどの節約設定",
      "似た画像を隠せる画像 NG",
      "画像のアップロードに対応。位置情報は取り除いて送ります（GIF を除く）",
    ],
    shots: [{ src: shotXCard, alt: "X のポストのカードと動画を表示した画面" }],
  },
  {
    kicker: "On-device AI",
    title: "AI は、端末の中だけで動く",
    body: "要約、翻訳、投稿前のチェック、自然文で書ける曖昧 NG。モデルは必要なものだけ入手でき、読み書きの内容を外部へ送りません。AI は初期状態でオフです。",
    points: [
      "新しい書き込みだけを数秒で要約",
      "Gemma 4、Qwen3.5、LFM2.5、Hy-MT2 から用途ごとに選択",
      "ベンチマークで、お使いの端末の速さを測れます",
    ],
    shots: [
      { src: shotSummary, alt: "AI の要約を表示した画面" },
      { src: shotTranslate, alt: "AI の翻訳を表示した画面" },
      { src: shotAi, alt: "AI のモデルを選ぶ画面" },
    ],
  },
  {
    kicker: "Yours",
    title: "自分好みに、とことん",
    body: "本文と AA のフォントは端末のフォントから選べます。NG は語句、ID、名前に対応し、強調表示で気になるレスを目立たせることもできます。",
    points: [
      "テーマ、文字の太さ、すりガラスの切り替え",
      "BE / UPLIFT に対応。書き込みごとにオン / オフできます",
      "打つほど花火が上がる、入力コンボの演出（オプション）",
    ],
    shots: [
      { src: shotFonts, alt: "フォントを選ぶ画面" },
      { src: shotCombo, alt: "入力コンボの演出" },
    ],
  },
];

function MobileLanding() {
  return (
    <main className="page doc-page mobile-page" id="top">
      <section className="section mobile-hero">
        <div className="mobile-hero-text">
          <p className="kicker">Ember for iOS / Android</p>
          <h1>
            5ch を、
            <br />
            ポケットに。
          </h1>
          <p className="lead">
            Ember のモバイル版です。アンカーをカードで辿り、画像も動画もその場で見て、
            要約や翻訳は端末の中の AI で。広告はありません。
          </p>
          <div className="store-badges">
            <StoreBadge href={APP_STORE_URL} src={badgeAppStore} label="App Store" />
            <StoreBadge href={GOOGLE_PLAY_URL} src={badgeGooglePlay} label="Google Play" />
          </div>
          <div className="doc-badges">
            <span className="doc-badge">無料</span>
            <span className="doc-badge">広告なし</span>
            <span className="doc-badge">オープンソース</span>
            <span className="doc-badge">AI は端末内で動作</span>
          </div>
        </div>
        <div className="phone-row mobile-hero-shots">
          <PhoneShot src={shotPopup} alt="アンカーのカードを重ねて表示した画面" eager />
          <PhoneShot src={shotThread} alt="スレッドの画面" eager />
        </div>
      </section>

      {FEATURES.map((feature) => (
        <section className="section mobile-feature" key={feature.kicker}>
          <div className="mobile-feature-text">
            <p className="kicker">{feature.kicker}</p>
            <h2>{feature.title}</h2>
            <p className="muted">{feature.body}</p>
            <ul className="doc-list">
              {feature.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
          <div className="phone-row">
            {feature.shots.map((shot) => (
              <PhoneShot key={shot.alt} src={shot.src} alt={shot.alt} />
            ))}
          </div>
        </section>
      ))}

      <section className="section">
        <div className="section-head">
          <p className="kicker">Notes</p>
          <h2>ご利用の前に</h2>
        </div>
        <ul className="doc-list">
          <li>Ember は非公式のアプリで、5ch.io およびその運営者とは関係がありません。</li>
          <li>オンデバイス AI のモデルは 0.7〜3.1 GB あります。Wi-Fi での入手をおすすめします。</li>
          <li>一部のモデルは RAM 8 GB 以上の端末向けです。</li>
          <li>
            <a className="inline-link" href="/privacy.html">プライバシーポリシー</a>、
            <a className="inline-link" href="/terms.html">利用規約</a>、
            <a className="inline-link" href="/support.html">サポート</a>もご確認ください。
          </li>
        </ul>
      </section>
    </main>
  );
}

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="page doc-page legal-page">
      <section className="section">
        <h1>{title}</h1>
        <p className="muted small">最終更新日: {LEGAL_UPDATED}</p>
        {children}
      </section>
    </main>
  );
}

function ContactLink() {
  return (
    <a className="inline-link" href={`mailto:${SUPPORT_EMAIL}`}>
      {SUPPORT_EMAIL}
    </a>
  );
}

function PrivacyPage() {
  return (
    <LegalShell title="プライバシーポリシー">
      <h2>はじめに</h2>
      <p>
        Ember モバイルアプリ（以下「本アプリ」）は、5ch.io を閲覧、投稿するための非公式ブラウザアプリです。
        本ポリシーは、iOS 版と Android 版の本アプリにおける情報の取り扱いを説明します。
      </p>

      <h2>開発者が収集しない情報</h2>
      <p>
        本アプリにアカウント登録はありません。開発者は、氏名、メールアドレス、電話番号、閲覧したスレッド、
        書き込みの内容、NG の設定、位置情報を収集しません。広告は表示せず、広告用の識別子も使いません。
      </p>

      <h2>端末の中に保存する情報</h2>
      <p>次の情報はお使いの端末の中に保存され、開発者には送信されません。</p>
      <ul>
        <li>閲覧履歴、既読位置、お気に入り、監視中のスレッド</li>
        <li>スレッドと画像のキャッシュ</li>
        <li>書き込み履歴、名前とメール欄の履歴、画像のアップロード履歴</li>
        <li>NG、画像 NG、強調表示、アプリの設定</li>
        <li>AI のモデルと、曖昧 NG のルール</li>
        <li>BE / UPLIFT のログイン情報（OS の安全な保管領域に保存）</li>
      </ul>

      <h2>ユーザー数の把握（RevenueCat）</h2>
      <p>
        ユーザー数を把握するために RevenueCat を利用しています。送信されるのは、アプリが自動で作る匿名の ID と、
        端末およびアプリの情報です。閲覧や書き込みの内容は送信しません。本アプリに課金はありません。
        詳しくは
        <a className="inline-link" href="https://www.revenuecat.com/privacy" target="_blank" rel="noreferrer">
          RevenueCat のプライバシーポリシー
        </a>
        をご覧ください。
      </p>

      <h2>外部サービスとの通信</h2>
      <p>
        本アプリは次の相手と直接通信します。通信先には、IP アドレスなど通信に必要な情報が伝わります。
        開発者がこの通信を中継することはありません。
      </p>
      <ul>
        <li><strong>5ch.io とその関連サービス</strong>: 板やスレッドの取得、書き込み、BE / UPLIFT のログイン。Cookie を端末に保存して送信します。</li>
        <li><strong>kenmo.org / 00c.org</strong>: 設定で表示を ON にしたときだけ、板やスレッドの取得と書き込みに使います。5ch.io とは別の運営者の掲示板です。Cookie を端末に保存して送信します。書き込みに必要な認証は、ブラウザで開いて行います。</li>
        <li><strong>ff5ch.syoboi.jp</strong>: スレッド検索をしたときに、検索語を送信します。</li>
        <li><strong>書き込みの中のリンク先</strong>: 画像、動画、リンクのカードを表示するときに、各サイトから取得します。設定で減らせます。</li>
        <li><strong>X（cdn.syndication.twimg.com）と YouTube（i.ytimg.com）</strong>: ポストのカードとサムネイルを表示するときに通信します。設定で止められます。</li>
        <li><strong>tadaup.jp</strong>: 画像のアップロードを選んだときに、その画像を送信します。アップロードした画像はインターネットに公開されます。GIF を除き、送信前に位置情報などの付加情報を取り除きます。</li>
        <li><strong>Hugging Face</strong>: AI のモデルを入手するときに通信します。</li>
        <li><strong>Expo</strong>: アプリの更新を確認するときに通信します。端末とアプリの情報が伝わります。</li>
      </ul>

      <h2>書き込みについて</h2>
      <p>
        書き込みは 5ch.io（kenmo.org / 00c.org の板ではそのサイト）に送信され、誰でも読める形で公開されます。
        本アプリから削除することはできません。書き込みの扱いには、書き込んだ掲示板の決まりが適用されます。
      </p>

      <h2>オンデバイス AI</h2>
      <p>
        要約、翻訳、投稿前チェック、曖昧 NG は端末の中だけで処理し、処理する文章を外部へ送信しません。
        通信が発生するのはモデルの入手時だけです。
      </p>

      <h2>端末の権限</h2>
      <ul>
        <li><strong>写真</strong>: 画像の保存と、投稿する画像の選択に使います。</li>
        <li><strong>カメラ</strong>: 投稿する写真の撮影に使います。</li>
      </ul>
      <p>いずれも操作したときにだけ使い、拒否してもそれ以外の機能は使えます。</p>

      <h2>データの削除</h2>
      <p>
        履歴とキャッシュは設定画面から消せます。BE / UPLIFT はログアウトするとログイン情報が消えます。
        本アプリを削除すると、端末の中のデータはすべて削除されます。
        開発者はデータを保有していないので、開発者側で消す作業はありません。
        tadaup.jp へのアップロードや 5ch.io、kenmo.org / 00c.org への書き込みは、各サービスの手続きに従ってください。
      </p>

      <h2>年齢について</h2>
      <p>
        本アプリは 18 歳以上の方を対象としています。18 歳未満の方の個人情報を意図して収集することはありません。
      </p>

      <h2>本ポリシーの変更</h2>
      <p>必要に応じて本ポリシーを更新することがあります。重要な変更は本ページでお知らせします。</p>

      <h2>お問い合わせ</h2>
      <p>本ポリシーについてのお問い合わせ: <ContactLink /></p>
    </LegalShell>
  );
}

function TermsPage() {
  return (
    <LegalShell title="利用規約">
      <h2>第 1 条（適用）</h2>
      <p>
        本利用規約（以下「本規約」）は、Ember モバイルアプリ（以下「本アプリ」）の利用条件を定めるものです。
        ユーザーは、本アプリを利用することで本規約に同意したものとみなされます。
      </p>

      <h2>第 2 条（本アプリの性質）</h2>
      <ol>
        <li>本アプリは、5ch.io を閲覧、投稿するための非公式ブラウザアプリです。</li>
        <li>本アプリは、5ch.io およびその運営者とは関係がありません。</li>
        <li>本アプリに表示されるコンテンツは 5ch.io の投稿者などが作成したものであり、開発者が作成したものではありません。</li>
        <li>本アプリは 18 歳以上の方を対象としています。18 歳未満の方はご利用いただけません。</li>
      </ol>

      <h2>第 3 条（書き込みと禁止事項）</h2>
      <ol>
        <li>本アプリからの書き込みは 5ch.io に送信され、誰でも読める形で公開されます。公開後に本アプリから消すことはできません。</li>
        <li>書き込みの内容の責任は書き込んだ本人が負い、5ch.io の決まりも適用されます。</li>
        <li>
          不適切な内容と迷惑な利用者を一切許容しません。次の行為を禁止します。
          <ul>
            <li>法令または公序良俗に反する内容、犯罪の予告や助長</li>
            <li>誹謗中傷、脅迫、嫌がらせ、差別</li>
            <li>他人の個人情報の公開</li>
            <li>性的な内容、児童を対象とする内容</li>
            <li>他人の権利の侵害、スパムや宣伝</li>
            <li>本アプリを悪用して 5ch.io やその他のサービスに過度な負荷をかける行為</li>
          </ul>
        </li>
      </ol>

      <h2>第 4 条（不適切なコンテンツへの対処）</h2>
      <ol>
        <li>他人の書き込みは、NG ワード、NG ID、NG 名前で非表示にできます。</li>
        <li>問題のある書き込みは、レスを長押しして「このレスを報告」から 5ch.io の削除要請板へ申請できます。</li>
        <li>問題のある内容は <ContactLink /> でも受け付けます。開発者への報告は 24 時間以内に確認し、必要に応じて 5ch.io へ削除を申請します。</li>
      </ol>

      <h2>第 5 条（オンデバイス AI）</h2>
      <p>
        AI による要約、翻訳、判定は誤りを含むことがあります。内容はご自身で確認してください。
      </p>

      <h2>第 6 条（免責事項）</h2>
      <ol>
        <li>開発者は、本アプリの完全性、正確性、信頼性、有用性を保証しません。</li>
        <li>5ch.io の仕様変更などにより、機能の一部または全部が使えなくなる場合があります。</li>
        <li>本アプリで閲覧、投稿されるコンテンツについて、開発者は責任を負いません。</li>
        <li>本アプリの利用により生じた損害について、開発者は法令で認められる範囲で責任を負いません。</li>
      </ol>

      <h2>第 7 条（提供の変更、中断、終了）</h2>
      <p>開発者は、事前の通知なく本アプリの内容を変更し、提供を中断または終了できるものとします。</p>

      <h2>第 8 条（知的財産権）</h2>
      <p>
        本アプリに関する権利は開発者に帰属し、ソースコードはリポジトリに記載のライセンスに従います。
        本アプリを通じて表示されるコンテンツの権利は、各権利者に帰属します。
      </p>

      <h2>第 9 条（規約の変更）</h2>
      <p>開発者は必要に応じて本規約を変更できます。変更後の規約は、本ページに掲載した時点で効力を生じます。</p>

      <h2>第 10 条（準拠法、管轄）</h2>
      <p>
        本規約は日本法に準拠し、本規約に関する紛争は東京地方裁判所を第一審の専属的合意管轄裁判所とします。
      </p>
    </LegalShell>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "スレッドや板が読み込めません",
    a: "インターネット接続を確認してください。5ch.io 側の障害やメンテナンスのときは読み込めません。時間をおいて、一覧を下に引いて更新してください。",
  },
  {
    q: "書き込みができません",
    a: "書き込みは 5ch.io のサーバーで処理されます。規制によって制限されている場合、本アプリ側では解除できません。エラーの文面は書き込み画面に表示されます。",
  },
  {
    q: "読みたくない書き込みを隠したい",
    a: "レスを長押しして、ID や名前、本文の語を NG に追加できます。登録したものは「設定」→「NG 管理」で確認できます。",
  },
  {
    q: "問題のある書き込みを報告したい",
    a: "レスを長押しして「このレスを報告」を選ぶと、5ch.io の削除要請板へ申請できます。下記のメールで開発者へ報告することもできます。報告は 24 時間以内に確認し、必要に応じて 5ch.io へ削除を申請します。Ember から書き込みそのものを消すことはできません。",
  },
  {
    q: "AI の項目が出てきません",
    a: "AI は初期状態でオフです。「設定」→「オンデバイス AI」でオンにして、モデルを入手してください。モデルが大きいので Wi-Fi をおすすめします。",
  },
  {
    q: "AI のモデルが選べません、動作が遅いです",
    a: "モデルによって必要な RAM が異なります。「設定」→「オンデバイス AI」→ ベンチマークで、お使いの端末の速さを確認できます。",
  },
  {
    q: "データを消したい",
    a: "履歴とキャッシュは設定画面から消せます。アプリを削除すると、端末の中のデータはすべて削除されます。バックアップと復元の機能はありません。",
  },
];

function SupportPage() {
  return (
    <LegalShell title="サポート">
      <h2>Ember について</h2>
      <p>
        Ember は 5ch.io を快適に読み書きするための非公式ブラウザアプリです。
        5ch.io およびその運営者とは関係がありません。
      </p>

      <h2>よくある質問</h2>
      <div className="doc-faq">
        {FAQ.map((item) => (
          <div key={item.q}>
            <h3>{item.q}</h3>
            <p>{item.a}</p>
          </div>
        ))}
      </div>

      <h2>お問い合わせ</h2>
      <p>上記で解決しない場合は、メールでお問い合わせください。</p>
      <p><strong>メール:</strong> <ContactLink /></p>
      <p>次の情報があると、スムーズに対応できます。</p>
      <ul>
        <li>端末の機種名と OS のバージョン</li>
        <li>アプリのバージョン（「設定」の一番下に表示されています）</li>
        <li>発生した手順と、表示されたメッセージ</li>
      </ul>
      <p>
        不具合の報告は{" "}
        <a className="inline-link" href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">
          GitHub Issues
        </a>{" "}
        でも受け付けています。
      </p>
    </LegalShell>
  );
}

export default function MobilePages({ page }: { page: MobilePageKey }) {
  return (
    <PageFrame>
      {page === "mobile" ? <MobileLanding /> : null}
      {page === "privacy" ? <PrivacyPage /> : null}
      {page === "terms" ? <TermsPage /> : null}
      {page === "support" ? <SupportPage /> : null}
    </PageFrame>
  );
}
