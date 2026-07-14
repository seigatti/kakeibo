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

export function rakutenBookmarklet(appUrl: string): string {
  // 楽天の商品ページから 商品名・寄付金額・自治体・URL を読み取り、ふるさと納税タブへプリフィル（保存はしない）
  const code = `(()=>{
var name=document.title.replace(/【楽天市場】/g,'').replace(/【ふるさと納税】/g,'').split('：')[0].trim().slice(0,120);
var price='';
var pe=document.querySelector('[itemprop=price]');
if(pe)price=(pe.getAttribute('content')||pe.textContent||'').replace(/[^0-9]/g,'');
if(!price){var m=document.body.innerText.match(/([0-9][0-9,]{2,})\\s*円/);if(m)price=m[1].replace(/,/g,'');}
var mu='';
var mm=document.body.innerText.match(/(北海道|東京都|(?:京都|大阪)府|[一-龠々]{2,3}県)\\s*[一-龠々ぁ-んァ-ヶ]{1,8}?[市町村区]/);
if(mm)mu=mm[0].replace(/\\s+/g,'');
var u='${appUrl}#furusato?name='+encodeURIComponent(name)+'&price='+price+'&municipality='+encodeURIComponent(mu)+'&url='+encodeURIComponent(location.origin+location.pathname);
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
