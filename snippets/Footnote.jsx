export function FootnoteRef({ id }) {
  const uniqueId = useId().replace(/:/g, "");

  return (
    <sup
      id={`fnref-${uniqueId}`}
      data-footnote={id}
      className="mx-0.5 scroll-mt-24 align-super text-xs"
    >
      <a
        href={`#fn-${id}`}
        className="font-bold text-black dark:text-white no-underline hover:underline"
      >
        [{id}]
      </a>
    </sup>
  );
}

export function Footnotes({ children }) {
  return (
    <section className="mt-2 border-t pt-4">
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Footnote({ id, children }) {
  const [refs, setRefs] = useState([]);

  useEffect(() => {
    setRefs(Array.from(document.querySelectorAll(`[data-footnote="${id}"]`)));
  }, [id]);

  return (
    <div id={`fn-${id}`} className="scroll-mt-24 flex items-start gap-2">
      <sup className="mt-0.5 font-bold text-sm">{id}</sup>

      <div className="items-center gap-5">
        <span>{children}</span>
        <span className="ml-3">
          {refs.map((ref) => (
            <button
              key={ref.id}
              type="button"
              title="Back to reference"
              aria-label="Back to reference"
              onClick={() => {
                const el = document.getElementById(ref.id);
                if (!el) return;

                el.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                  inline: "nearest",
                });

                requestAnimationFrame(() => {
                  el.style.transition = "background-color 200ms ease";
                  el.style.backgroundColor = "#fef08a"; // Tailwind yellow-200

                  const clear = () => {
                    el.style.backgroundColor = "";

                    window.removeEventListener("wheel", clear, true);
                    window.removeEventListener("touchstart", clear, true);
                    window.removeEventListener("mousedown", clear, true);
                    window.removeEventListener("keydown", clear, true);
                  };

                  window.addEventListener("wheel", clear, true);
                  window.addEventListener("touchstart", clear, true);
                  window.addEventListener("mousedown", clear, true);
                  window.addEventListener("keydown", clear, true);
                });
              }}
              className="text-gray-500 transition-colors hover:text-blue-600"
            >
              ↩︎
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
