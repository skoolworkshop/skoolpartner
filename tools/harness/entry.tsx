import { renderToStaticMarkup } from "react-dom/server";
import "@/app/globals.css";
import { Harness } from "./cjp-harness";

export const html = renderToStaticMarkup(<Harness />);
