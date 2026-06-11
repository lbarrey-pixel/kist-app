/** tailwind.config.js — Sistema de design "Cabine" da Kist
 *  Mescle o bloco `extend` ao seu config atual. As cores e fontes abaixo
 *  são as únicas dependências dos componentes (kist-ui.jsx, App.jsx, etc).
 */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink:     "#0B1F3A", // navy da sidebar / texto mais escuro
        ink2:    "#13294D",
        inkmut:  "#9FB0CC", // texto suave sobre o navy
        kist:    "#1F6FEB", // azul de ação (CTA / logo)
        kist600: "#175FD3",
        signal:  "#4FA62E", // verde "confirmado / match exato" (donuts do site)
        signalbg:"#EAF5E5",
        amber:   "#B7791F", // incerto / pendente
        amberbg: "#FBF1DD",
        rose:    "#D14343", // sem match / destrutivo
        rosebg:  "#FBE9E9",
        paper:   "#F6F7F9", // fundo do conteúdo
        surface: "#FFFFFF",
        line:    "#E7EAF1",
        line2:   "#DCE0EA",
        sub:     "#5B6577", // texto secundário
        faint:   "#97A0AF", // texto terciário / placeholders
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
