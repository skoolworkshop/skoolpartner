import { renderToStaticMarkup } from "react-dom/server";
import "@/app/globals.css";
import { Harness } from "./gmail-harness";

export const html = renderToStaticMarkup(<Harness />);
