/**
 * マネーフォワード/Zaimのページから数値を読み取り、
 * このアプリの資産記録画面へプリフィル付きで飛ぶブックマークレットを生成する。
 * ページのHTML構造変更で動かなくなった場合は prompt() で手貼りにフォールバックする。
 */

/** このアプリ自身のURL（#より前） */
export function appBaseUrl(): string {
  return location.origin + location.pathname
}

export function mfBookmarklet(appUrl: string): string {
  const code = `(()=>{
var t=document.body.innerText;
var g=function(re){var m=t.match(re);return m?m[1].replace(/[,，]/g,''):''};
var inv=g(/(?:資産総額|総資産)[^0-9\\-]*([0-9,]+)\\s*円/);
var prof=g(/評価損益[^0-9+\\-]*([+\\-]?[0-9,]+)\\s*円/);
var pen=g(/年金[^0-9\\-]*([0-9,]+)\\s*円/);
if(!inv)inv=prompt('総資産を自動検出できませんでした。金額を貼り付けてください','')||'';
if(!inv)return;
var u='${appUrl}#assets?investment='+inv+(prof?'&profit='+prof:'')+(pen?'&pension='+pen:'');
window.open(u,'_blank');
})()`
  return 'javascript:' + encodeURIComponent(code.replace(/\n/g, ''))
}

export function zaimBookmarklet(appUrl: string): string {
  const code = `(()=>{
var t=document.body.innerText;
var m=t.match(/(?:残高合計|合計残高|残高)[^0-9\\-]*([\\-]?[0-9,]+)\\s*円?/);
var c=m?m[1].replace(/[,，]/g,''):'';
if(!c)c=prompt('合計残高を自動検出できませんでした。金額を貼り付けてください','')||'';
if(!c)return;
window.open('${appUrl}#assets?cash='+c,'_blank');
})()`
  return 'javascript:' + encodeURIComponent(code.replace(/\n/g, ''))
}
