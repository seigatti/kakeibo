# 家計簿 PWA（自分専用・費用ゼロ）

資産スナップショット（投資=マネーフォワード / 現金=Zaim / 年金）と月次収支を記録・グラフ化する自分専用アプリ。

```
[PWA (React+Chart.js)] ←JSON→ [GAS Web App API] ←→ [Googleスプレッドシート「家計簿DB」]
  GitHub Pages で配信            自分として実行           データ実体（Googleが自動バックアップ）
```

- **スマホでもPCでも同じURL**。ホーム画面に追加すればアプリとして起動
- **データは自分のGoogleドライブ上のシート**なので、端末が壊れても失われない
- 月額費用ゼロ（GitHub Pages / GAS / Google Sheets すべて無料枠）

## フォルダ構成

| パス | 内容 |
|---|---|
| `web/` | PWA フロントエンド（Vite + React + TypeScript + Chart.js） |
| `gas/Code.gs` | Google Apps Script（API サーバー。手動で貼り付けてデプロイ） |
| `migration/migrate.py` | 家計簿.xlsx → シートへの初回データ移行 |
| `.github/workflows/deploy.yml` | GitHub Pages 自動デプロイ |

## セットアップ手順（初回のみ）

### 1. GAS API のデプロイ（約5分）
1. https://script.google.com → 「新しいプロジェクト」
2. `gas/Code.gs` の内容をエディタに貼り付けて保存（プロジェクト名は「家計簿API」など）
3. 上部の関数選択で **`setup`** を選んで「実行」→ 権限を承認
4. 「実行ログ」に表示される **スプレッドシートURL** と **APIトークン** を控える
5. 「デプロイ」→「新しいデプロイ」→ 種類「**ウェブアプリ**」
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
6. 発行された **ウェブアプリURL**（`https://script.google.com/macros/s/…/exec`）を控える

### 2. 既存Excelデータの移行（1コマンド）
```
python migration/migrate.py --upload --url <ウェブアプリURL> --token <APIトークン>
```
実行後、スプレッドシート「家計簿DB」に資産27件・変動費33ヶ月分・固定費14件が入る。

### 3. GitHub Pages 公開
1. GitHub で新規リポジトリ作成（例: `kakeibo`。**Public**）
2. このフォルダを push:
   ```
   git remote add origin https://github.com/<ユーザー名>/kakeibo.git
   git push -u origin main
   ```
3. リポジトリの Settings → Pages → Source を「**GitHub Actions**」にする
4. Actions タブでデプロイ完了後、`https://<ユーザー名>.github.io/kakeibo/` にアクセス

※個人データ（xlsx・移行JSON）は `.gitignore` 済みでリポジトリには入らない。

### 4. アプリ初期設定
1. 公開URLを開き、設定タブで **ウェブアプリURL** と **APIトークン** を入力 → 「保存して接続テスト」
2. ホーム画面に追加:
   - iPhone: Safari で開き 共有 → 「ホーム画面に追加」
   - Android: Chrome で開き メニュー → 「アプリをインストール」
   - （端末ごとに初回だけ設定タブでURL/トークンの入力が必要）

### 5. ブックマークレット（転記を1タップに）
設定タブに表示されるコードをブックマークとして登録すると、
マネーフォワード/Zaim のページを開いた状態から1タップで数値入力済みの記録画面が開く。
詳しくはアプリの設定タブを参照。

## ふだんの使い方
- **資産の記録**（週1 or 月1）: マネフォ・Zaimを開いてブックマークレット → 保存。過去日付の入力もOK
- **収支の入力**（月1）: 収支タブで対象月の給料と変動費（ガス代・電気代など）を入力。固定費の月割りは自動加算
- **固定費の変更**: 固定費タブで追加/編集。解約したものは「終了月」を入れると過去の集計を壊さない

## 開発
```
cd web
npm install
npm run dev     # http://localhost:5173
npm run build   # 本番ビルド (dist/)
```
GAS を修正した場合は script.google.com で貼り直し、「デプロイ」→「デプロイを管理」→ 既存デプロイを**編集して新バージョン**にする（新規デプロイにするとURLが変わるので注意）。

## 将来の拡張候補
- Zaim 公式API（OAuth 1.0a）連携で現金残高の完全自動記録
- GAS の時間トリガーによる定期スナップショット
