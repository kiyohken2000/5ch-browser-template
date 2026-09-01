# アイコン

- `icon.png` は **512x512 固定**。Tauri の deb / rpm バンドラは PNG の実サイズを
  そのまま hicolor のディレクトリ名に使うため、非標準サイズ (以前は 500x500) だと
  `/usr/share/icons/hicolor/500x500/apps/ember.png` に入り、多くのデスクトップ環境が
  ランチャーでアイコンを見つけられない。差し替えるときは必ず 512x512 にすること。
- `icon.ico` は Windows 用 (マルチサイズ)。

サイズ確認:

```bash
python -c "import struct;d=open('icon.png','rb').read();print(struct.unpack('>II',d[16:24]))"
```
