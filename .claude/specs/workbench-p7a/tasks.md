# 案件ワークベンチ P7a — タスク

## T1 種別と波及
- 触るファイル: `src/core/schema.js` `src/core/dashboard.js` `src/core/health.js` `src/core/hearing.js` `src/core/prompts.js`（gapsText） `src/core/report.js` `src/core/impact.js` `src/ui/detail.js` `src/ui/views/list.js` `src/ui/views/overview.js` `test/kpi.test.mjs` `test/risk.test.mjs`
- やること: kpi・risk の定義、design.md の波及の表
- **完了条件:** テストで次を確かめる
  - kpi・risk を差分で足せ、リスクは既定で社内のみになる（画面の操作の add でも）。見込み・影響は 1〜5 の整数で、数の 3 を受け付け、0・6・小数は誤り。kpi の parent の循環が誤りになる
  - 版は 2 のまま。KPI もリスクも無い台帳は今のテストどおり
  - リスクの担当・期限なし・期限切れが健康診断に出て、ダッシュボードの期限の分布と期限切れが落ちずに一致する
  - 健康診断の新しい 4 つの規則が design.md の「健康診断の対象」どおりに出る（KPI が 0 件のとき・要望とつながらない要件・直接つないだ要件・取り下げの KPI の境界）。リスク・KPI に出典なし・推測のままが出ない
  - リスク・KPI がヒヤリングの候補にも「ヒヤリング質問の生成」の材料にも入らない。社内のみの項目が変更要求書の文面に出ない（impactOf の結果は変わらない）
  - 既存のテストが全部通る

## T2 KPI の木
- 触るファイル: `src/core/kpi.js` `src/ui/views/kpi-tree.js` `test/kpi.test.mjs`
- **完了条件:** テストで、ゴールごとの KPI・子の KPI（祖先の goal で置き場所が決まり、2 回出ない）・施策（不採用を除く）・要件・直接の要件の木と、ゴール未設定・循環でも止まることを確かめる。ブラウザで表と図が出て、40 を超えると図が出ない

## T3 リスク
- 触るファイル: `src/core/risk.js` `src/ui/views/risks.js` `src/styles.css` `test/risk.test.mjs` `test/ui-colors.test.mjs`
- **完了条件:** テストで、ヒートマップの数（監視中・対策中だけ）・点数の段・課題へ移す（1 回の操作で課題が足され、リスクが発生になり、取り消しで両方戻る。発生・解消のリスクには出ない）を確かめる。ヒートマップの色の組み合わせのコントラストが 4.5 以上。ブラウザで「リスクを足す」で足せる

## T4 指示文・カルテ・使い方
- 触るファイル: `src/core/prompts.js` `src/core/karte.js` `src/core/guide-text.js` `src/core/screens.js` `src/app.js` `build.mjs` `test/prompts.test.mjs` `test/karte.test.mjs`
- **完了条件:** 目的が 22 になり、2 つの指示文に対象の種別の一覧が載る。カルテの risks（発生・解消の印つき）が gemini-kit の検証（tools/check-karte.mjs）で warn を増やさない。使い方の画面の説明・FAQ・用語が出る。KPI・リスクを各状態 1 件ずつ含む台帳を ?debug で開き、概要・一覧・詳細・定例会資料・使い方の本文に「undefined」が無く、コンソールに誤りが出ない
