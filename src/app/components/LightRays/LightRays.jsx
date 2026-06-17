import { useEffect, useRef, useState } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import "./LightRays.css";

const DEFAULT_RAYS_COLOR = "#ffffff";

function parseHexColor(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];

  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
}

function resolveRayOrigin(origin, width, height) {
  switch (origin) {
    case "top-left":
      return { anchor: [0, -0.2 * height], dir: [0, 1] };
    case "top-right":
      return { anchor: [width, -0.2 * height], dir: [0, 1] };
    case "left":
      return { anchor: [-0.2 * width, 0.5 * height], dir: [1, 0] };
    case "right":
      return { anchor: [1.2 * width, 0.5 * height], dir: [-1, 0] };
    case "bottom-left":
      return { anchor: [0, 1.2 * height], dir: [0, -1] };
    case "bottom-center":
      return { anchor: [0.5 * width, 1.2 * height], dir: [0, -1] };
    case "bottom-right":
      return { anchor: [width, 1.2 * height], dir: [0, -1] };
    case "top-center":
    default:
      return { anchor: [0.5 * width, -0.2 * height], dir: [0, 1] };
  }
}

const vertexShader = `
attribute vec2 position;
varying vec2 vUv;

void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 rayPos;
uniform vec2 rayDir;
uniform vec3 raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2 mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

varying vec2 vUv;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float rayStrength(
  vec2 raySource,
  vec2 rayRefDirection,
  vec2 coord,
  float seedA,
  float seedB,
  float speed
) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);
  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));
  float distance = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);
  float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);
  float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;
  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0,
    1.0
  );

  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 finalRayDir = rayDir;

  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  vec4 rays1 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349, 1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234, 1.1 * raysSpeed);

  fragColor = rays1 * 0.5 + rays2 * 0.4;

  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n);
  }

  float brightness = 1.0 - (coord.y / iResolution.y);
  fragColor.x *= 0.1 + brightness * 0.8;
  fragColor.y *= 0.3 + brightness * 0.6;
  fragColor.z *= 0.5 + brightness * 0.5;

  if (saturation != 1.0) {
    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
  }

  fragColor.rgb *= raysColor;
}

void main() {
  vec4 color;
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}
`;

export default function LightRays({
  raysOrigin = "top-center",
  raysColor = DEFAULT_RAYS_COLOR,
  raysSpeed = 1,
  lightSpread = 1,
  rayLength = 2,
  pulsating = false,
  fadeDistance = 1,
  saturation = 1,
  followMouse = true,
  mouseInfluence = 0.1,
  noiseAmount = 0,
  distortion = 0,
  className = "",
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const uniformsRef = useRef(null);
  const meshRef = useRef(null);
  const targetMouseRef = useRef({ x: 0.5, y: 0.5 });
  const smoothMouseRef = useRef({ x: 0.5, y: 0.5 });
  const frameRef = useRef(null);
  const cleanupRef = useRef(null);
  const observerRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    observerRef.current = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observerRef.current.observe(containerRef.current);

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isVisible || !containerRef.current) return undefined;

    cleanupRef.current?.();
    cleanupRef.current = null;

    let disposed = false;

    const init = async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 10);
      });

      const container = containerRef.current;
      if (!container || disposed) return;

      const renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        alpha: true,
      });
      rendererRef.current = renderer;

      const gl = renderer.gl;
      Object.assign(gl.canvas.style, {
        width: "100%",
        height: "100%",
      });

      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(gl.canvas);

      const uniforms = {
        iTime: { value: 0 },
        iResolution: { value: [1, 1] },
        rayPos: { value: [0, 0] },
        rayDir: { value: [0, 1] },
        raysColor: { value: parseHexColor(raysColor) },
        raysSpeed: { value: raysSpeed },
        lightSpread: { value: lightSpread },
        rayLength: { value: rayLength },
        pulsating: { value: pulsating ? 1 : 0 },
        fadeDistance: { value: fadeDistance },
        saturation: { value: saturation },
        mousePos: { value: [0.5, 0.5] },
        mouseInfluence: { value: mouseInfluence },
        noiseAmount: { value: noiseAmount },
        distortion: { value: distortion },
      };
      uniformsRef.current = uniforms;

      const geometry = new Triangle(gl);
      const program = new Program(gl, {
        vertex: vertexShader,
        fragment: fragmentShader,
        uniforms,
      });
      const mesh = new Mesh(gl, { geometry, program });
      meshRef.current = mesh;

      const resize = () => {
        const activeContainer = containerRef.current;
        const activeRenderer = rendererRef.current;
        if (!activeContainer || !activeRenderer) return;

        activeRenderer.dpr = Math.min(window.devicePixelRatio || 1, 2);
        const { clientWidth, clientHeight } = activeContainer;
        activeRenderer.setSize(clientWidth, clientHeight);

        const width = clientWidth * activeRenderer.dpr;
        const height = clientHeight * activeRenderer.dpr;
        uniforms.iResolution.value = [width, height];

        const { anchor, dir } = resolveRayOrigin(raysOrigin, width, height);
        uniforms.rayPos.value = anchor;
        uniforms.rayDir.value = dir;
      };

      const render = (time) => {
        if (!rendererRef.current || !uniformsRef.current || !meshRef.current) return;

        uniforms.iTime.value = time * 0.001;

        if (followMouse && mouseInfluence > 0) {
          smoothMouseRef.current.x = smoothMouseRef.current.x * 0.92 + targetMouseRef.current.x * 0.08;
          smoothMouseRef.current.y = smoothMouseRef.current.y * 0.92 + targetMouseRef.current.y * 0.08;
          uniforms.mousePos.value = [smoothMouseRef.current.x, smoothMouseRef.current.y];
        }

        try {
          renderer.render({ scene: mesh });
          frameRef.current = requestAnimationFrame(render);
        } catch (error) {
          console.warn("WebGL rendering error:", error);
        }
      };

      window.addEventListener("resize", resize);
      resize();
      frameRef.current = requestAnimationFrame(render);

      cleanupRef.current = () => {
        if (frameRef.current) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }

        window.removeEventListener("resize", resize);

        try {
          const canvas = renderer.gl.canvas;
          const loseContext = renderer.gl.getExtension("WEBGL_lose_context");
          loseContext?.loseContext();
          canvas?.parentNode?.removeChild(canvas);
        } catch (error) {
          console.warn("Error during WebGL cleanup:", error);
        }

        rendererRef.current = null;
        uniformsRef.current = null;
        meshRef.current = null;
      };
    };

    init();

    return () => {
      disposed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [
    distortion,
    fadeDistance,
    followMouse,
    isVisible,
    lightSpread,
    mouseInfluence,
    noiseAmount,
    pulsating,
    rayLength,
    raysColor,
    raysOrigin,
    raysSpeed,
    saturation,
  ]);

  useEffect(() => {
    if (!uniformsRef.current || !containerRef.current || !rendererRef.current) return;

    const uniforms = uniformsRef.current;
    uniforms.raysColor.value = parseHexColor(raysColor);
    uniforms.raysSpeed.value = raysSpeed;
    uniforms.lightSpread.value = lightSpread;
    uniforms.rayLength.value = rayLength;
    uniforms.pulsating.value = pulsating ? 1 : 0;
    uniforms.fadeDistance.value = fadeDistance;
    uniforms.saturation.value = saturation;
    uniforms.mouseInfluence.value = mouseInfluence;
    uniforms.noiseAmount.value = noiseAmount;
    uniforms.distortion.value = distortion;

    const { clientWidth, clientHeight } = containerRef.current;
    const { dpr } = rendererRef.current;
    const { anchor, dir } = resolveRayOrigin(raysOrigin, clientWidth * dpr, clientHeight * dpr);
    uniforms.rayPos.value = anchor;
    uniforms.rayDir.value = dir;
  }, [
    distortion,
    fadeDistance,
    lightSpread,
    mouseInfluence,
    noiseAmount,
    pulsating,
    rayLength,
    raysColor,
    raysOrigin,
    raysSpeed,
    saturation,
  ]);

  useEffect(() => {
    if (!followMouse) return undefined;

    const handleMouseMove = (event) => {
      if (!containerRef.current || !rendererRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      targetMouseRef.current = {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [followMouse]);

  return <div ref={containerRef} className={`light-rays-container ${className}`.trim()} />;
}
