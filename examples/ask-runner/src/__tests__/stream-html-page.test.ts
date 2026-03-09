import { JSDOM } from "jsdom";

import {
  buildStreamHtmlPage,
  buildStreamHtmlPageClientScript,
} from "../app/http/stream-html-page";

interface RuntimeMocks {
  marked: { parse(markdown: string, options: unknown): string };
  DOMPurify: { sanitize(html: string): string };
  mermaid: {
    initialize(config: unknown): void;
    render(id: string, source: string): Promise<{ svg: string }>;
  };
}

describe("stream html page client", () => {
  async function runClient(
    markdownChunks: string[],
    mocks: RuntimeMocks,
    options?: { manualStream?: boolean },
  ) {
    const dom = new JSDOM(buildStreamHtmlPage(), {
      runScripts: "outside-only",
      url: "http://localhost:3010/stream-html?query=runner",
    });
    const { window } = dom;

    Object.defineProperty(window, "requestAnimationFrame", {
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
      configurable: true,
    });

    Object.defineProperty(window.navigator, "clipboard", {
      value: {
        writeText: jest.fn(async () => undefined),
      },
      configurable: true,
    });

    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;

        if (!options?.manualStream) {
          for (const chunk of markdownChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        }
      },
    });

    Object.defineProperty(window, "fetch", {
      value: jest.fn(async () => ({
        ok: true,
        body: stream,
        text: async () => "",
      })),
      configurable: true,
    });

    Object.defineProperty(window, "TextDecoder", {
      value: TextDecoder,
      configurable: true,
    });

    const importBlock = `const [{ marked }, { default: DOMPurify }, { default: mermaid }] =
          await Promise.all([
            import("/__ask-runner-assets/marked/marked.esm.js"),
            import("/__ask-runner-assets/dompurify/purify.es.mjs"),
            import("/__ask-runner-assets/mermaid/mermaid.esm.min.mjs"),
          ]);`;

    const mockedImportBlock = `const { marked, DOMPurify, mermaid } = window.__streamHtmlTestMocks;`;
    const script = buildStreamHtmlPageClientScript().replace(
      importBlock,
      mockedImportBlock,
    );

    Object.defineProperty(window, "__streamHtmlTestMocks", {
      value: mocks,
      configurable: true,
    });

    Object.defineProperty(window.console, "error", {
      value: jest.fn(),
      configurable: true,
    });

    const scriptPromise = window.eval(script) as Promise<void>;
    if (!options?.manualStream) {
      await scriptPromise;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    return {
      dom,
      pushChunk(chunk: string) {
        streamController?.enqueue(encoder.encode(chunk));
      },
      closeStream() {
        streamController?.close();
      },
      async flush() {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
      async waitForCompletion() {
        await scriptPromise;
      },
    };
  }

  test("streams markdown, highlights code, and renders mermaid blocks", async () => {
    const mermaid = {
      initialize: jest.fn(),
      render: jest.fn(async (_id: string, source: string) => ({
        svg: "<svg><text>" + source + "</text></svg>",
      })),
    };

    const { dom } = await runClient(
      [
        "## Runner\n\n```mermaid\nflowchart TD\nA-->B\n```\n\n",
        "```typescript\nconst app = run();\n```\n",
      ],
      {
        marked: {
          parse: jest.fn((markdown: string) => {
            if (!markdown.includes("```mermaid")) {
              return "<p>empty</p>";
            }

            return [
              "<h2>Runner</h2>",
              '<pre><code class="language-mermaid">flowchart TD\nA--&gt;B\n</code></pre>',
              '<pre><code class="language-typescript">const app = run();\n</code></pre>',
            ].join("");
          }),
        },
        DOMPurify: {
          sanitize: jest.fn((html: string) => html),
        },
        mermaid,
      },
    );

    const { document } = dom.window;
    const output = document.getElementById("markdown-output");
    const status = document.getElementById("stream-status");
    const copyButton = document.getElementById("copy-markdown-button");

    expect(output?.innerHTML).toContain("mermaid-shell");
    expect(output?.innerHTML).toContain("<svg><text>flowchart TD\nA--&gt;B\n</text></svg>");
    expect(output?.innerHTML).toContain('class="code-token-keyword">const</span>');
    expect(output?.innerHTML).toContain('class="code-token-function">run</span>');
    expect(status?.textContent).toBe("Stream complete.");
    expect(copyButton?.hasAttribute("hidden")).toBe(false);
    expect(mermaid.initialize).toHaveBeenCalled();
    expect(mermaid.render.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test("keeps mermaid errors in place and logs them", async () => {
    const mermaid = {
      initialize: jest.fn(),
      render: jest.fn(async () => {
        throw new Error("Syntax error in text");
      }),
    };

    const { dom } = await runClient(
      ["```mermaid\nflowchart TD\nA-->B\n```\n"],
      {
        marked: {
          parse: jest.fn(
            () => '<pre><code class="language-mermaid">flowchart TD\nA--&gt;B\n</code></pre>',
          ),
        },
        DOMPurify: {
          sanitize: jest.fn((html: string) => html),
        },
        mermaid,
      },
    );

    const { document, console } = dom.window;
    const output = document.getElementById("markdown-output");

    expect(output?.innerHTML).toContain("Mermaid render failed.");
    expect(output?.innerHTML).toContain("flowchart TD");
    expect(console.error).toHaveBeenCalled();
  });
});
