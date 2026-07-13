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
  // マネフォの「資産総額」は年金を含むため、年金が取れた場合は 投資=総額−年金 とする
  const code = `(()=>{
var t=document.body.innerText;
var g=function(re){var m=t.match(re);return m?m[1].replace(/[,，]/g,''):''};
var total=g(/(?:資産総額|総資産)[^0-9\\-]*([0-9,]+)\\s*円/);
var prof=g(/評価損益[^0-9+\\-]*([+\\-]?[0-9,]+)\\s*円/);
var pen=g(/年金[^0-9\\-]*([0-9,]+)\\s*円/);
if(!total)total=prompt('総資産を自動検出できませんでした。金額を貼り付けてください','')||'';
if(!total)return;
var inv=pen?String(Number(total)-Number(pen)):total;
var u='${appUrl}#assets?investment='+inv+(prof?'&profit='+prof:'')+(pen?'&pension='+pen:'')+'&autosave=1';
var w=window.open(u,'_blank');
if(!w)location.href=u;
})()`
  return 'javascript:' + encodeURIComponent(code.replace(/\n/g, ''))
}

export function zaimBookmarklet(appUrl: string): string {
  const code = `(()=>{
var t=document.body.innerText;
var m=t.match(/(?:合計残高|残高合計|合計)[：:\\s]*[¥￥]?\\s*(-?[0-9][0-9,]*)/);
var c=m?m[1].replace(/[,，]/g,''):'';
if(!c)c=prompt('合計残高を自動検出できませんでした。金額を貼り付けてください','')||'';
if(!c)return;
var u='${appUrl}#assets?cash='+c+'&autosave=1';
var w=window.open(u,'_blank');
if(!w)location.href=u;
})()`
  return 'javascript:' + encodeURIComponent(code.replace(/\n/g, ''))
}
