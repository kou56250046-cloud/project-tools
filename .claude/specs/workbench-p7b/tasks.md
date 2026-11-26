# 案件ワークベンチ P7b — タスク

## T1 スキーマと補い
- 触るファイル: `src/core/schema.js` `src/core/raci.js` `test/raci.test.mjs`
- **完了条件:** テストで次を確かめる
  - reportsTo・teamRole・raci を差分でも画面の操作でも足せる
  - raci の誤り（関係者でない ID・R/A/C/I 以外・同じ人の重複）と reportsTo の循環が誤りになる
  - refsOf が raci の who を返す。関係者を指す raci の tempId が置き換わる。仮の関係者を却下したら要素ごと外れる。存在しない ID が健康診断に出る
  - effectiveRaci の役ごとの補い（R が明示に無ければ担当、A が明示に無く決めた人が 1 人ならその人、決めた人が 2 人なら補わない、明示で別の役を持つ人には補わない）
  - cycleRole の順と、setRaciOp が明示の要素だけを書き直す（補いを書き写さない）
  - raci から人が消える update で、removedElements がその人を返す
  - 既存のテストが全部通る

## T2 体制図と RACI 表
- 触るファイル: `src/core/org.js` `src/core/patch.js`（removedElements） `src/ui/views/org.js` `src/ui/detail.js` `src/core/screens.js` `src/app.js` `build.mjs` `src/styles.css`
- **完了条件:**
  - テストで、orgLayout が列・所属・木の深さで箱を置き、別の列の上長への線を cross にし、循環でも止まる
  - テストで、所属なし・上長の循環（箱が消えない）・列の順が schema の立場の順
  - ブラウザで、体制図と RACI 表が出て、セルを押すと役が変わり、取り消しで戻る。詳細パネルで上長と体制上の役割を変えられる。説明用の表示ではセルを押せない

## T3 健康診断・指示文・使い方
- 触るファイル: `src/core/health.js` `src/core/prompts.js` `src/core/guide-text.js` `test/raci.test.mjs` `test/prompts.test.mjs`
- **完了条件:** 4 つの規則が条件どおりに出る。指示文の種別の説明と台帳の一覧に raci が読める形で出る（[object Object] にならない）。目的が 1 つ増える。使い方の説明・用語が出る
