# 案件ワークベンチ 使い方の流れ図 — タスク

## T1 段のデータと進み具合
- 触るファイル: `src/core/guide-text.js` `src/core/guide-flow.js` `build.mjs` `test/guide.test.mjs`
- やること: FLOW_STEPS・FLOW_EDGES・MEETING_TIMELINE を足し、FIRST_STEPS・ROUND_TRIP・PHASES の文を段へ移して消す。stepStatus を書く
- **完了条件:** テストで次を確かめる
  - 段の画面・指示文が実在する。矢印の両端が段にある
  - 全段に「入れるもの・出るもの・次に持っていく先・手順」がある
  - how 全体に design.md の語の一覧がすべて含まれる
  - 今の PHASES が案内していた画面・指示文が、すべてどれかの段に入っている（消す前の一覧をテストに書いておく）
  - stepStatus が design.md の「端の場合」の表の 7 通りすべてで期待どおり

## T2 図・カード・会議の前後
- 触るファイル: `src/ui/views/guide.js` `src/styles.css`
- やること: design.md の図（固定の位置の SVG）・カード・会議の前後・章立て
- **完了条件:**
  - ブラウザで、台帳なし・ロック中・型だけの台帳・繰り返しの最中（ベースラインなし）・サンプル台帳の 5 つの状態で使い方を開き、次を確かめる
    - 幅 1280px で箱どうしが重ならない
    - 名前が箱からはみ出さない
    - 繰り返しの最中は枠が太くなる
  - 箱を押すとカードへ移る。Tab で流れの順に移り、金の枠が見え、Enter と Space で移る
  - 説明用の表示で、進み具合と、隠れる画面・指示文のボタンが出ない
  - テスト（ui-colors を含む）が全部通る
