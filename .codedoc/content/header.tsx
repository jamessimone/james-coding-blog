import { CodedocConfig } from "@codedoc/core";

export function Header(config: CodedocConfig, renderer: any) {
  return (
    <header style="margin-left: 1rem">
      Read more at <a href="https://wwww.jamessimone.net">jamessimone.net</a>,
      or return to the <a href="/">homepage</a>
    </header>
  );
}
