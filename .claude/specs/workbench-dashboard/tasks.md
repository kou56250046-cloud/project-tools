# 案件ワークベンチ 概要画面のダッシュボード — タスク

## T1 部品の取り込み
- 触るファイル: `src/vendor/dash.js` `src/vendor/dash.css` `src/styles.css` `build.mjs` `test/ui-colors.test.mjs` `test/build.test.mjs`
- やること: dash.js・dash.css を写し、色を変数に置き換え、ビルドに入れる
- **完了条件:**
  - ビルドが通り、テストで次を確かめる
    - `Dash` が 1 回だけ定義される
    - vendor の JS に innerHTML・fetch・eval・new Function が無い
    - dash.css に #fff 以外の直書きの色が無い
    - --d-* の組み合わせのコントラストが 4.5 以上
  - 既存のテストが全部通る

## T2 集計
- 触るファイル: `src/core/dashboard.js` `src/core/health.js`（dueTargets を出す） `build.mjs`（JS_FILES に core/dashboard.js） `test/dashboard.test.mjs`
- やること: dashboardData（design.md の 2）
- **完了条件:** テストで次を確かめる
  - サンプル台帳で、KPI・各グラフの数がテストの中で手で数えた値と一致する
  - 作業が無い台帳で hasTasks false・curve null。見積の無い作業だけの台帳で hasTasks true・hasTargets false。開始前の台帳で spi null
  - 期限切れの件数が runHealth の overdue の件数と一致する（親の作業がある台帳で）
  - notAskedYet の質問が「まだ聞いていない」、作成日の無い課題が「日数不明」に入る。区切りが ballWaitDays に従う
  - 期限の無い台帳で、期限切れ 0 件・期限の分布がすべて 0
  - 要件が全部取り下げの台帳で、合意率が null
  - 説明用の表示では、社内のみの項目が数えられない
  - 週の境目（日曜・月曜）の振り分けが正しい

## T3 概要画面
- 触るファイル: `src/ui/views/overview.js` `src/styles.css` `src/core/guide-text.js`
- やること: KPI 4 枚・グラフ 5 つ・並び替え・説明用の表示の出し分け
- **完了条件:**
  - ブラウザで、サンプル台帳・作業の無い台帳・説明用の表示の 3 つで概要を開き、次を確かめる
    - 幅 1280px と 800px で横スクロールが出ず、全グラフの SVG の幅が親の幅以下
    - 代わりの表が開ける
    - KPI の「開く」で各画面へ移る
    - 説明用の表示で、出さないと決めた KPI とグラフが出ない
  - 合計 0 件のグラフに「まだありません」が出て、KPI に NaN が出ない
  - コンソールに dash.js の警告（compare なし）が出ない
