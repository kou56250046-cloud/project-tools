# 案件ワークベンチ P6a — タスク

## T1 色と字体
- 触るファイル: `src/styles.css` `test/ui-colors.test.mjs`
- やること: :root の値を dash.css の値にし、新しい変数を足す。:root の外の直書きの色を変数に置き換える
- **完了条件:** test/ui-colors.test.mjs が通る（design.md の組み合わせがすべて 4.5 以上・:root の外に #fff 以外の直書きの色が無い）。既存のテストも全部通る

## T2 上のバー
- 触るファイル: `src/shell.html` `src/styles.css`（必要なら `src/app.js`）
- やること: 濃紺の 2 段の上のバー（1 段目に名前・案件・状態・操作、2 段目に分類のタブ）。画面のタブは白地の段
- **完了条件:** ブラウザで、概要・関係図・取込・ガント・ER・使い方の 6 画面を撮り、上のバーが 2 段で崩れていない。幅 1280px で 1 段目が折り返さない。Tab キーで上のバーの部品を順に移動でき、金の枠が見える。ロック画面・説明用の表示・案件が 2 件以上（切り替えの select）でも崩れない。上のバーのボタンにホバーした状態と、押せない取り消しを撮って読めることを確かめる。詳細パネルを開いても上のバーが隠れない

## T3 カルテへの変換
- 触るファイル: `src/core/karte.js` `build.mjs` `test/karte.test.mjs`
- やること: ledgerToKarte（design.md の対応表）
- **完了条件:** テストで、サンプル台帳の書き出しについて次を確かめる
  - ID がすべて「接頭辞-2 桁以上」
  - source・raisedIn・answeredBy が実在する
  - 列挙値と観点が gemini-kit の値の中にある
  - 社内のみの項目は既定で入らず、includeInternal で入る
  - ID が台帳の ID から決まる（RE-003 → F-10003、QA-005 → Q-05 と F-40005）。項目を足しても既存の ID が変わらない
  - 取り下げ・不採用・解消・置き換え済み・完了・中止・クローズの項目が、design.md の「状態の写し方」のとおりに残る
  - 回答済み・クローズで回答のある質問から事実が作られ、answeredBy でつながる。回答の無い回答済みは answeredBy が ""
  - status の規則（confidence の有無・要件の agreed）、askedOn ← askedAt、answeredOn ← ""
  - quote がすべて ""。template の出典が sources に入らない
  - wbId と idMap が元の ID を指す。notes が条件どおりに出る
  - 台帳のオブジェクトが変わらない（書き出しの前後で JSON が同じ）

## T4 書き出しの画面と gemini-kit での確認
- 触るファイル: `src/ui/views/settings.js` `tools/check-karte.mjs`
- やること: 設定の「書き出す」の欄のボタンとダイアログ。開発用の確認スクリプト
- **完了条件:**
  - ブラウザで書き出しができ、ファイル名が `_karte_rev<N>_` の形になる。書き出しの後も rev と書き出しの状態が変わらない
  - `node tools/check-karte.mjs` で、samples/sample-ledger.json と、スクリプトの中で作る端の場合の台帳（確度なし・回答済み・回答なしのクローズ・取り下げ・社内のみ）を、社内のみを含める・含めないの両方で書き出し、gemini-kit の parse → normalize → validate にかける。fixes 0 件・error 0 件・warn は quote のものだけ

## T5 使い方
- 触るファイル: `src/core/guide-text.js`
- やること: 設定の画面の説明と、よくある困りごとに「gemini-kit で文書を作りたい」を足す
- **完了条件:** 使い方の画面に表示される。test/guide.test.mjs が通る
