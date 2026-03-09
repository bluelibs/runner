const markedCdnUrl =
  "https://cdn.jsdelivr.net/npm/marked@15.0.12/lib/marked.umd.min.js";
const markedCdnIntegrity =
  "sha384-zCewoQXXb5Xf+2nvCjab0EbMl7FWVpJMsKyrc8M8DqxjFra4DY4XHwheVdHXa34k";
const domPurifyCdnUrl =
  "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js";
const domPurifyCdnIntegrity =
  "sha384-JEyTNhjM6R1ElGoJns4U2Ln4ofPcqzSsynQkmEc/KGy6336qAZl70tDLufbkla+3";

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
        padding: 40px 0 56px;
      }

      .hero,
      .output {
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--panel);
        backdrop-filter: blur(8px);
        box-shadow: 0 18px 60px rgba(61, 45, 27, 0.08);
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
        background: rgba(29, 27, 24, 0.05);
      }

      .empty {
        color: var(--muted);
      }

      @media (max-width: 720px) {
        main {
          width: min(100vw - 20px, 960px);
          padding-top: 20px;
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

    <script src="${markedCdnUrl}" integrity="${markedCdnIntegrity}" crossorigin="anonymous"></script>
    <script src="${domPurifyCdnUrl}" integrity="${domPurifyCdnIntegrity}" crossorigin="anonymous"></script>
    <script>
      (async () => {
        const output = document.getElementById("markdown-output");
        const status = document.getElementById("stream-status");
        const queryContainer = document.getElementById("stream-query");
        const queryText = queryContainer ? queryContainer.querySelector("span") : null;
        const form = document.getElementById("query-form");
        const queryInput = document.getElementById("query-input");

        if (!(output instanceof HTMLElement) || !(status instanceof HTMLElement) || !(form instanceof HTMLFormElement) || !(queryInput instanceof HTMLInputElement)) {
          return;
        }

        const params = new URLSearchParams(window.location.search);
        const query = (params.get("query") || "").trim();
        queryInput.value = query;

        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const nextQuery = queryInput.value.trim();
          const nextUrl = nextQuery.length > 0 ? "/stream-html?query=" + encodeURIComponent(nextQuery) : "/stream-html";
          window.location.assign(nextUrl);
        });

        const setStatus = (tone, message) => {
          status.dataset.tone = tone;
          status.textContent = message;
        };

        const setQuery = (value) => {
          if (queryText) {
            queryText.textContent = value || "none";
          }
        };

        const renderMarkdown = (markdown) => {
          const renderedHtml = window.marked.parse(markdown, { gfm: true, breaks: true });
          output.innerHTML = window.DOMPurify.sanitize(renderedHtml);
          output.classList.remove("empty");
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
          let markdown = "";
          let renderScheduled = false;

          const flushRender = () => {
            renderScheduled = false;
            renderMarkdown(markdown);
          };

          const scheduleRender = () => {
            if (renderScheduled) {
              return;
            }

            renderScheduled = true;
            window.requestAnimationFrame(flushRender);
          };

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
          renderMarkdown(markdown);
          setStatus("done", "Stream complete.");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unexpected error.";
          output.textContent = message;
          output.classList.add("empty");
          setStatus("error", message);
        }
      })();
    </script>
  </body>
</html>`;
}
