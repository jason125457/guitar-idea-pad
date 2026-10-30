// 自架字型（OFL-1.1，授權見 public/licenses/fonts.txt）：只載入拉丁字母子集與用到的字重。
// 好處：不再向 Google 發請求、不擋第一次繪製（font-display: swap）、離線時也有字型（會被預快取）。
// 中文字沿用系統字型（Noto Sans TC／微軟正黑體），見 styles.css 的 font-family。
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/righteous/latin-400.css';
