import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default [
  { ignores: ["backend/**", ".next/**", "out/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    files: ["src/components/**/*.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
];
