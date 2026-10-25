/* ===================== boot ===================== */
setPageVisual();
fitZoom();
setTool('pick');
setShirt('Black');
Promise.race([Promise.all(FONTS.map(f => document.fonts.load(`40px "${f}"`))), new Promise(r => setTimeout(r, 2500))])
  .finally(async () => {
    fabric.util.clearFabricFontCache();
    await Store.init();
    setStatus('Choose or start a design');
    Home.show();
  });
