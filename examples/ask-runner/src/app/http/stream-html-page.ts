const markedBrowserModuleUrl = "/__ask-runner-assets/marked/marked.esm.js";
const domPurifyBrowserModuleUrl = "/__ask-runner-assets/dompurify/purify.es.mjs";
const mermaidBrowserModuleUrl =
  "/__ask-runner-assets/mermaid/mermaid.esm.min.mjs";

export function buildStreamHtmlPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ask Runner Stream Viewer</title>
    <style>
      :root {
        color-scheme: light;
        --page: #f4efe6;
        --panel: rgba(255, 252, 246, 0.92);
        --panel-strong: #fffdf8;
        --ink: #1d1b18;
        --muted: #6f6458;
        --line: rgba(56, 43, 28, 0.14);
        --accent: #0f766e;
        --accent-soft: rgba(15, 118, 110, 0.12);
        --danger: #b42318;
        --shadow: rgba(61, 45, 27, 0.08);
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(196, 139, 51, 0.18), transparent 34%),
          linear-gradient(180deg, #fbf7ef 0%, var(--page) 100%);
      }

      main {
        width: min(960px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 40px 0 144px;
      }

      .hero,
      .output {
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--panel);
        backdrop-filter: blur(8px);
        box-shadow: 0 18px 60px var(--shadow);
      }

      .hero {
        padding: 28px;
      }

      .eyebrow {
        margin: 0 0 10px;
        color: var(--accent);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 5vw, 3.5rem);
        line-height: 0.95;
        letter-spacing: -0.04em;
      }

      .lede {
        margin: 14px 0 0;
        max-width: 58ch;
        color: var(--muted);
        font-size: 1.02rem;
        line-height: 1.6;
      }

      form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        margin-top: 24px;
      }

      label {
        display: block;
        margin-bottom: 8px;
        color: var(--muted);
        font-size: 0.9rem;
      }

      input {
        width: 100%;
        padding: 14px 16px;
        border: 1px solid rgba(29, 27, 24, 0.14);
        border-radius: 16px;
        background: var(--panel-strong);
        color: var(--ink);
        font: inherit;
      }

      button {
        align-self: end;
        padding: 14px 18px;
        border: 0;
        border-radius: 999px;
        background: var(--ink);
        color: #fffdf8;
        font: inherit;
        cursor: pointer;
      }

      button[hidden] {
        display: none;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 18px;
      }

      .pill {
        padding: 10px 14px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.5);
        font-size: 0.92rem;
      }

      .status[data-tone="loading"],
      .status[data-tone="streaming"],
      .status[data-tone="done"] {
        background: var(--accent-soft);
      }

      .status[data-tone="error"] {
        background: rgba(180, 35, 24, 0.1);
        color: var(--danger);
      }

      .output {
        margin-top: 22px;
        padding: 28px;
      }

      .output article {
        min-height: 180px;
        line-height: 1.75;
      }

      .output article > :first-child {
        margin-top: 0;
      }

      .output article > :last-child {
        margin-bottom: 0;
      }

      .output code,
      .output pre {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      }

      .output pre {
        overflow-x: auto;
        padding: 16px;
        border-radius: 16px;
        background: #191613;
        color: #f8f1e6;
      }

      .output pre code {
        display: block;
        padding: 0;
        background: transparent;
        color: inherit;
      }

      .output :not(pre) > code {
        font-size: 0.92em;
        padding: 0.1em 0.35em;
        border-radius: 0.5em;
        background: rgba(29, 27, 24, 0.07);
      }

      .output .hljs-comment,
      .output .code-token-comment,
      .output .hljs-quote {
        color: #a89d92;
      }

      .output .code-token-keyword,
      .output .code-token-operator,
      .output .hljs-keyword,
      .output .hljs-selector-tag,
      .output .hljs-literal,
      .output .hljs-title,
      .output .hljs-section,
      .output .hljs-type {
        color: #f3bf76;
      }

      .output .code-token-string,
      .output .code-token-property,
      .output .hljs-string,
      .output .hljs-attr,
      .output .hljs-template-tag,
      .output .hljs-template-variable {
        color: #9fd3c7;
      }

      .output .code-token-number,
      .output .code-token-boolean,
      .output .code-token-null,
      .output .code-token-variable,
      .output .hljs-number,
      .output .hljs-symbol,
      .output .hljs-bullet,
      .output .hljs-variable,
      .output .hljs-built_in {
        color: #ff9d7d;
      }

      .output .code-token-function,
      .output .code-token-type {
        color: #f4d35e;
      }

      .output .hljs-emphasis {
        font-style: italic;
      }

      .output .hljs-strong {
        font-weight: 700;
      }

      .mermaid-shell {
        margin: 1.5rem 0;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.74);
        overflow-x: auto;
      }

      .mermaid-shell svg {
        display: block;
        max-width: 100%;
        height: auto;
        margin: 0 auto;
      }

      .mermaid-error {
        margin: 1.5rem 0;
        padding: 16px;
        border: 1px solid rgba(180, 35, 24, 0.2);
        border-radius: 20px;
        background: rgba(180, 35, 24, 0.06);
        color: var(--danger);
      }

      .mermaid-error pre {
        margin: 12px 0 0;
        background: rgba(25, 22, 19, 0.9);
      }

      .response-footer {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10;
        border-top: 1px solid var(--line);
        background: rgba(255, 252, 246, 0.96);
        backdrop-filter: blur(12px);
        box-shadow: 0 -10px 30px var(--shadow);
      }

      .response-footer__inner {
        width: min(960px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 14px 0 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      .response-footer__copy {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .response-footer__hint {
        color: var(--muted);
        font-size: 0.92rem;
      }

      .response-footer__status {
        color: var(--muted);
        font-size: 0.92rem;
        min-height: 1.2em;
      }

      .empty {
        color: var(--muted);
      }

      @media (max-width: 720px) {
        main {
          width: min(100vw - 20px, 960px);
          padding-top: 20px;
          padding-bottom: 168px;
        }

        .hero,
        .output {
          border-radius: 20px;
          padding: 20px;
        }

        form {
          grid-template-columns: 1fr;
        }

        button {
          width: 100%;
        }

        .response-footer__inner {
          width: min(100vw - 20px, 960px);
          padding-top: 12px;
          padding-bottom: 16px;
          flex-direction: column;
          align-items: stretch;
        }

        .response-footer__copy {
          flex-direction: column;
          align-items: stretch;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Ask Runner</p>
        <h1>Live Markdown Stream</h1>
        <p class="lede">
          This page reads streamed markdown from <code>/stream?query=...</code> and renders the answer as HTML while the response is still arriving.
        </p>

        <form id="query-form">
          <div>
            <label for="query-input">Query</label>
            <input id="query-input" name="query" type="text" placeholder="How does Runner handle resource lifecycle?" autocomplete="off" />
          </div>
          <button type="submit">Stream Answer</button>
        </form>

        <div class="meta">
          <div class="pill">Source: <code>/stream?query=...</code></div>
          <div id="stream-status" class="pill status" data-tone="idle">Waiting for a query.</div>
          <div id="stream-query" class="pill">Query: <span>none</span></div>
        </div>
      </section>

      <section class="output">
        <article id="markdown-output" class="empty">Add <code>?query=...</code> to the URL or use the form above.</article>
      </section>
    </main>

    <footer class="response-footer">
      <div class="response-footer__inner">
        <div class="response-footer__hint">
          Mermaid blocks render inline. Standard fenced code blocks keep their language-aware highlighting.
        </div>
        <div class="response-footer__copy">
          <div id="copy-status" class="response-footer__status" aria-live="polite"></div>
          <button id="copy-markdown-button" type="button" hidden>Copy markdown</button>
        </div>
      </div>
    </footer>

    <script type="module">
${buildStreamHtmlPageClientScript()}
    </script>
  </body>
</html>`;
}

export function buildStreamHtmlPageClientScript(): string {
  return `      (async () => {
        const [{ marked }, { default: DOMPurify }, { default: mermaid }] =
          await Promise.all([
            import("${markedBrowserModuleUrl}"),
            import("${domPurifyBrowserModuleUrl}"),
            import("${mermaidBrowserModuleUrl}"),
          ]);

        const output = document.getElementById("markdown-output");
        const status = document.getElementById("stream-status");
        const queryContainer = document.getElementById("stream-query");
        const queryText = queryContainer ? queryContainer.querySelector("span") : null;
        const form = document.getElementById("query-form");
        const queryInput = document.getElementById("query-input");
        const copyButton = document.getElementById("copy-markdown-button");
        const copyStatus = document.getElementById("copy-status");

        if (
          !(output instanceof HTMLElement) ||
          !(status instanceof HTMLElement) ||
          !(form instanceof HTMLFormElement) ||
          !(queryInput instanceof HTMLInputElement) ||
          !(copyButton instanceof HTMLButtonElement) ||
          !(copyStatus instanceof HTMLElement)
        ) {
          return;
        }

        let markdown = "";
        let streamCompleted = false;
        let renderScheduled = false;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
        });

        const escapeHtml = (value) =>
          value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

        const highlightJson = (code) =>
          escapeHtml(code).replace(
            /("(?:\\\\.|[^"\\\\])*")(\\s*:)?|\\b(true|false|null)\\b|-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b/g,
            (match, stringLiteral, propertySuffix, keywordLiteral) => {
              if (stringLiteral && propertySuffix) {
                return '<span class="code-token-property">' + stringLiteral + "</span>" + propertySuffix;
              }

              if (stringLiteral) {
                return '<span class="code-token-string">' + stringLiteral + "</span>";
              }

              if (keywordLiteral === "true" || keywordLiteral === "false") {
                return '<span class="code-token-boolean">' + match + "</span>";
              }

              if (keywordLiteral === "null") {
                return '<span class="code-token-null">' + match + "</span>";
              }

              return '<span class="code-token-number">' + match + "</span>";
            },
          );

        const highlightScript = (code) =>
          escapeHtml(code)
            .replace(/(\\/\\/.*$|\\/\\*[\\s\\S]*?\\*\\/)/gm, '<span class="code-token-comment">$1</span>')
            .replace(/('(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*")/g, '<span class="code-token-string">$1</span>')
            .replace(/\\b(import|from|export|return|const|let|var|function|async|await|if|else|switch|case|break|continue|throw|try|catch|finally|new|class|extends|implements|interface|type|enum|public|private|protected|readonly|static|yield|default)\\b/g, '<span class="code-token-keyword">$1</span>')
            .replace(/\\b(string|number|boolean|unknown|never|void|any|object)\\b/g, '<span class="code-token-type">$1</span>')
            .replace(/\\b([A-Z][A-Za-z0-9_]*)\\b/g, '<span class="code-token-type">$1</span>')
            .replace(/\\b([a-zA-Z_$][\\w$]*)(?=\\s*\\()/g, '<span class="code-token-function">$1</span>')
            .replace(/\\b\\d+(?:\\.\\d+)?\\b/g, '<span class="code-token-number">$&</span>');

        const highlightBash = (code) =>
          escapeHtml(code)
            .replace(/(^|\\s)(#.*)$/gm, '$1<span class="code-token-comment">$2</span>')
            .replace(/('(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*")/g, '<span class="code-token-string">$1</span>')
            .replace(/\\$[A-Za-z_][A-Za-z0-9_]*|\\$\\{[^}]+\\}/g, '<span class="code-token-variable">$&</span>')
            .replace(/\\b(if|then|else|fi|for|do|done|case|esac|while|function|in|export)\\b/g, '<span class="code-token-keyword">$1</span>');

        const highlightDiff = (code) =>
          escapeHtml(code)
            .replace(/^(\\+.*)$/gm, '<span class="code-token-string">$1</span>')
            .replace(/^(-.*)$/gm, '<span class="code-token-comment">$1</span>')
            .replace(/^(@@.*@@)$/gm, '<span class="code-token-keyword">$1</span>');

        const highlightYamlOrMarkdown = (code) =>
          escapeHtml(code)
            .replace(/(^|\\n)(\\s*#.*)(?=\\n|$)/g, '$1<span class="code-token-comment">$2</span>')
            .replace(/("[^"\\n]*"|'[^'\\n]*')/g, '<span class="code-token-string">$1</span>')
            .replace(/\\b(true|false|null)\\b/g, '<span class="code-token-boolean">$1</span>')
            .replace(/\\b\\d+(?:\\.\\d+)?\\b/g, '<span class="code-token-number">$&</span>');

        const highlightCode = (code, language) => {
          const normalizedLanguage = (language || "").toLowerCase();

          if (normalizedLanguage === "typescript" || normalizedLanguage === "ts" || normalizedLanguage === "javascript" || normalizedLanguage === "js") {
            return highlightScript(code);
          }

          if (normalizedLanguage === "json") {
            return highlightJson(code);
          }

          if (normalizedLanguage === "bash" || normalizedLanguage === "sh" || normalizedLanguage === "shell") {
            return highlightBash(code);
          }

          if (normalizedLanguage === "diff") {
            return highlightDiff(code);
          }

          if (normalizedLanguage === "yaml" || normalizedLanguage === "yml" || normalizedLanguage === "markdown" || normalizedLanguage === "md") {
            return highlightYamlOrMarkdown(code);
          }

          return escapeHtml(code);
        };

        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const nextQuery = queryInput.value.trim();
          const nextUrl = nextQuery.length > 0 ? "/stream-html?query=" + encodeURIComponent(nextQuery) : "/stream-html";
          window.location.assign(nextUrl);
        });

        copyButton.addEventListener("click", async () => {
          if (!streamCompleted || markdown.length === 0) {
            return;
          }

          try {
            await navigator.clipboard.writeText(markdown);
            copyStatus.textContent = "Markdown copied.";
          } catch (_error) {
            copyStatus.textContent = "Clipboard access failed.";
          }
        });

        const params = new URLSearchParams(window.location.search);
        const query = (params.get("query") || "").trim();
        queryInput.value = query;

        const setStatus = (tone, message) => {
          status.dataset.tone = tone;
          status.textContent = message;
        };

        const setQuery = (value) => {
          if (queryText) {
            queryText.textContent = value || "none";
          }
        };

        const setCopyReady = (ready) => {
          streamCompleted = ready;
          copyButton.hidden = !ready;

          if (!ready) {
            copyStatus.textContent = "";
          }
        };

        const renderMermaidBlocks = async () => {
          const mermaidBlocks = output.querySelectorAll("pre > code.language-mermaid");

          for (const mermaidCodeBlock of mermaidBlocks) {
            if (!(mermaidCodeBlock instanceof HTMLElement)) {
              continue;
            }

            const pre = mermaidCodeBlock.parentElement;
            if (!(pre instanceof HTMLElement)) {
              continue;
            }

            const shell = document.createElement("div");
            shell.className = "mermaid-shell";
            const diagramSource = mermaidCodeBlock.textContent || "";
            const mermaidContainer = pre.parentElement;
            if (!(mermaidContainer instanceof HTMLElement)) {
              continue;
            }

            try {
              const renderResult = await mermaid.render(
                "mermaid-diagram-" + Math.random().toString(36).slice(2),
                diagramSource,
              );
              shell.innerHTML = renderResult.svg;
              mermaidContainer.replaceChild(shell, pre);
            } catch (error) {
              console.error("Mermaid render failed", {
                error,
                diagramSource,
              });

              const errorShell = document.createElement("div");
              errorShell.className = "mermaid-error";
              errorShell.innerHTML =
                "<strong>Mermaid render failed.</strong><pre><code class=\\"language-mermaid\\"></code></pre>";

              const errorCodeBlock = errorShell.querySelector("code");
              if (errorCodeBlock instanceof HTMLElement) {
                errorCodeBlock.textContent = diagramSource;
              }

              mermaidContainer.replaceChild(errorShell, pre);
            }
          }
        };

        const renderMarkdown = async (renderMermaid = false) => {
          const renderedHtml = marked.parse(markdown, {
            gfm: true,
            breaks: true,
          });
          output.innerHTML = DOMPurify.sanitize(renderedHtml);
          output.classList.toggle("empty", markdown.trim().length === 0);

          for (const codeBlock of output.querySelectorAll("pre code")) {
            if (!(codeBlock instanceof HTMLElement)) {
              continue;
            }

            const className = codeBlock.className || "";
            if (className.includes("language-mermaid")) {
              continue;
            }

            const languageMatch = className.match(/language-([\\w-]+)/);
            const language = languageMatch ? languageMatch[1] : "";
            codeBlock.innerHTML = highlightCode(codeBlock.textContent || "", language);
          }

          if (renderMermaid) {
            await renderMermaidBlocks();
          }
        };

        const flushRender = async () => {
          renderScheduled = false;
          await renderMarkdown(false);
        };

        const renderCompletedMermaid = async () => {
          await new Promise((resolve) => {
            window.requestAnimationFrame(() => resolve(undefined));
          });
          await renderMarkdown(true);
        };

        const scheduleRender = () => {
          if (renderScheduled) {
            return;
          }

          renderScheduled = true;
          window.requestAnimationFrame(() => {
            void flushRender();
          });
        };

        const readErrorMessage = async (response) => {
          const text = await response.text();

          try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed.error === "string") {
              return parsed.error;
            }
          } catch (_error) {
            return text || "Unexpected error.";
          }

          return text || "Unexpected error.";
        };

        setQuery(query);
        setCopyReady(false);

        if (!query) {
          setStatus("idle", "Waiting for a query.");
          return;
        }

        setStatus("loading", "Connecting to the stream...");
        output.textContent = "Opening stream...";

        try {
          const response = await fetch("/stream?query=" + encodeURIComponent(query), {
            headers: { Accept: "text/markdown" },
          });

          if (!response.ok) {
            throw new Error(await readErrorMessage(response));
          }

          if (!response.body) {
            throw new Error("This browser does not expose streaming responses.");
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          setStatus("streaming", "Streaming response...");

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            markdown += decoder.decode(value, { stream: true });
            scheduleRender();
          }

          markdown += decoder.decode();
          await renderCompletedMermaid();
          setCopyReady(true);
          setStatus("done", "Stream complete.");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unexpected error.";
          output.textContent = message;
          output.classList.add("empty");
          setStatus("error", message);
          setCopyReady(false);
        }
      })();`;
}
