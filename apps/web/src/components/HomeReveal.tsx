"use client";

import { useEffect } from "react";

// Progressive enhancement for the homepage scroll-in animation. The `.reveal`
// elements are fully visible by default; we only opt into the hidden/animated
// state once JS is present by adding the `js` class to the `.tm-home` root.
export default function HomeReveal() {
  useEffect(() => {
    const root = document.querySelector(".tm-home");
    if (!root) return;
    root.classList.add("js");

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14 },
    );

    const els = root.querySelectorAll(".reveal:not(.in)");
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
