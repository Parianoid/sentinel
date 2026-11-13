import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paypal: {
          navy: "#002991",
          sky: "#60CDFF",
          sand: "#f1efea",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,.05), 0 10px 30px rgba(0,41,145,.05)",
      },
    },
  },
  plugins: [],
};

export default config;
