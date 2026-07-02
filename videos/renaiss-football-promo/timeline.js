window.__timelines = window.__timelines || {};

var tl = gsap.timeline({ paused: true });

function cut(previousSelector, selector, at) {
  tl.set(previousSelector, { opacity: 0 }, at);
  tl.fromTo(selector, { opacity: 0 }, { opacity: 1, duration: 0.42, ease: "power2.inOut" }, at);
}

function enter(selector, fromVars, at, duration = 0.42, ease = "power2.out") {
  tl.fromTo(
    selector,
    { opacity: 0, ...fromVars },
    { opacity: 1, x: 0, y: 0, scale: 1, duration, ease, immediateRender: false },
    at,
  );
}

function caption(selector, start, end) {
  tl.fromTo(selector, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.24, ease: "power2.out" }, start);
  tl.to(selector, { y: -10, opacity: 0, duration: 0.22, ease: "power2.in" }, end);
}

tl.to(".hero-bg", { scale: 1.055, duration: 4.2, ease: "none" }, 0);
enter("#scene-hero .brand-lockup", { y: -18, scale: 0.99 }, 0.18, 0.42, "power3.out");
enter(".hero-copy .eyebrow", { y: 12 }, 0.32, 0.32, "power2.out");
enter(".hero-copy h1", { y: 24 }, 0.48, 0.54, "expo.out");
enter(".hero-copy p", { y: 14 }, 0.96, 0.38, "sine.out");
tl.fromTo(".hero-rail span", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, stagger: 0.07, ease: "power2.out", immediateRender: false }, 1.32);

cut("#scene-hero", "#scene-map", 4.05);
enter(".map-copy", { y: 18 }, 4.24, 0.46, "power3.out");
enter(".schedule-focus", { y: 18, scale: 0.99 }, 4.34, 0.5, "expo.out");
tl.fromTo(".round-line span", { opacity: 0 }, { opacity: 1, duration: 0.28, stagger: 0.05, ease: "sine.out", immediateRender: false }, 5.32);
tl.to(".schedule-focus img", { scale: 1.03, y: -10, duration: 4.5, ease: "none" }, 4.38);

cut("#scene-map", "#scene-vote", 8.65);
enter(".vote-list", { y: 20, scale: 0.99 }, 8.86, 0.46, "expo.out");
enter(".vote-copy", { y: 16 }, 9.04, 0.42, "power3.out");
enter(".vote-panel", { y: 14, scale: 0.99 }, 9.56, 0.36, "power2.out");
tl.fromTo(".vote-steps span", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.26, stagger: 0.07, ease: "sine.out", immediateRender: false }, 10.1);
tl.to(".vote-list img", { scale: 1.032, y: -16, duration: 4.7, ease: "none" }, 8.9);

cut("#scene-vote", "#scene-pool", 13.15);
enter(".pool-copy", { y: 18 }, 13.34, 0.44, "power3.out");
enter(".pool-status", { y: 14, scale: 0.99 }, 13.52, 0.46, "expo.out");
tl.fromTo(".prize-strip span", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, stagger: 0.08, ease: "power2.out", immediateRender: false }, 14.26);
tl.fromTo(".prize-card", { y: 18, opacity: 0, scale: 0.99 }, { y: 0, opacity: 1, scale: 1, duration: 0.46, ease: "expo.out", immediateRender: false }, 14.72);

cut("#scene-pool", "#scene-reveal", 18.0);
enter(".draw-stage", { y: 16, scale: 0.99 }, 18.16, 0.42, "expo.out");
enter(".reveal-monitor", { y: 14, scale: 0.99 }, 18.3, 0.42, "expo.out");
enter(".reveal-copy", { y: 16 }, 18.68, 0.4, "power3.out");
tl.fromTo(".reveal-steps span", { opacity: 0 }, { opacity: 1, duration: 0.24, stagger: 0.05, ease: "sine.out", immediateRender: false }, 19.46);
tl.to(".draw-stage img", { scale: 1.025, duration: 5.6, ease: "none" }, 18.26);
tl.to(".reveal-monitor", { scale: 1.025, duration: 5.3, ease: "sine.inOut" }, 19.0);

cut("#scene-reveal", "#scene-close", 23.55);
enter(".winner-board", { y: 16, scale: 0.99 }, 23.82, 0.44, "expo.out");
enter(".close-copy", { y: 20 }, 24.04, 0.5, "expo.out");
tl.fromTo(".close-bg", { scale: 1.02 }, { scale: 1.055, duration: 4.4, ease: "none" }, 23.55);
tl.to(".fade-black", { opacity: 1, duration: 0.44, ease: "sine.inOut" }, 27.48);

caption(".cap-1", 0.72, 4.0);
caption(".cap-2", 4.36, 8.34);
caption(".cap-3", 8.98, 13.05);
caption(".cap-4", 13.52, 17.76);
caption(".cap-5", 18.32, 23.28);

window.__timelines["renaiss-football-promo"] = tl;
