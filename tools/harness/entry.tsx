import { renderToStaticMarkup } from "react-dom/server";
import "@/app/globals.css";
import { Harness } from "./diagnose-harness";

export const html = renderToStaticMarkup(<Harness />);
