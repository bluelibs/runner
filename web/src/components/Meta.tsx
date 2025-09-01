import { useEffect } from "react";

interface MetaProps {
  title: string;
  description?: string;
  image?: string;
  type?: string; // og:type
  canonicalUrl?: string;
}

// Lightweight meta manager without external deps (Helmet)
export const Meta: React.FC<MetaProps> = ({
  title,
  description,
  image,
  type = "website",
  canonicalUrl,
}) => {
  useEffect(() => {
    if (title) document.title = title;

    const ensureTag = (
      selector: string,
      create: () => HTMLElement,
      set: (el: HTMLElement) => void,
    ) => {
      let el = document.head.querySelector(selector) as HTMLElement | null;
      if (!el) {
        el = create();
        document.head.appendChild(el);
      }
      set(el);
    };

    if (description) {
      ensureTag(
        'meta[name="description"]',
        () => Object.assign(document.createElement("meta"), { name: "description" }),
        (el) => el.setAttribute("content", description),
      );
    }

    ensureTag(
      'meta[property="og:title"]',
      () => {
        const m = document.createElement("meta");
        m.setAttribute("property", "og:title");
        return m;
      },
      (el) => el.setAttribute("content", title),
    );

    ensureTag(
      'meta[property="og:type"]',
      () => {
        const m = document.createElement("meta");
        m.setAttribute("property", "og:type");
        return m;
      },
      (el) => el.setAttribute("content", type),
    );

    if (description) {
      ensureTag(
        'meta[property="og:description"]',
        () => {
          const m = document.createElement("meta");
          m.setAttribute("property", "og:description");
          return m;
        },
        (el) => el.setAttribute("content", description),
      );
      ensureTag(
        'meta[name="twitter:description"]',
        () => Object.assign(document.createElement("meta"), { name: "twitter:description" }),
        (el) => el.setAttribute("content", description),
      );
    }

    if (image) {
      ensureTag(
        'meta[property="og:image"]',
        () => {
          const m = document.createElement("meta");
          m.setAttribute("property", "og:image");
          return m;
        },
        (el) => el.setAttribute("content", image),
      );
      ensureTag(
        'meta[name="twitter:image"]',
        () => Object.assign(document.createElement("meta"), { name: "twitter:image" }),
        (el) => el.setAttribute("content", image),
      );
    }

    ensureTag(
      'meta[name="twitter:card"]',
      () => Object.assign(document.createElement("meta"), { name: "twitter:card" }),
      (el) => el.setAttribute("content", image ? "summary_large_image" : "summary"),
    );

    // Canonical link
    const url = canonicalUrl || window.location.href;
    let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = url;
  }, [title, description, image, type, canonicalUrl]);

  return null;
};

export default Meta;
