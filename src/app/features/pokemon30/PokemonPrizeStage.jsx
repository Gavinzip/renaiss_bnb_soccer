import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from "three";

import pokemon30PrizeBoxCrystalThin from "../../assets/pokemon30-prize-box-crystal-thin.jpg";
import { createPokemon30SealedBoosterBoxModel } from "./createPokemon30SealedBoosterBoxModel";

function disposeScene(root) {
  root.traverse((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.filter(Boolean).forEach((material) => {
      Object.values(material).forEach((value) => value?.isTexture && value.dispose());
      material.dispose?.();
    });
  });
}

export function PokemonPrizeStage() {
  const hostRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let active = true;
    let renderer;
    let frameId;
    let resizeObserver;
    let model;
    let cleanUpPointerListeners = () => {};

    try {
      const scene = new Scene();
      const camera = new PerspectiveCamera(31, 1, 0.1, 100);
      // The presentation is intentionally a vertical, top-down product view.
      // Depth only belongs to the interactive pseudo-3D object, never to the
      // default artwork framing.
      camera.position.set(0, 12.4, 0.001);
      camera.up.set(0, 0, -1);
      camera.lookAt(0, 0.3, 0);

      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFSoftShadowMap;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.03;
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.domElement.className = "pokemon-prize-stage__canvas";
      renderer.domElement.setAttribute("aria-label", "可拖曳查看的 Pokémon 30 週年展示盒 3D 模型");
      renderer.domElement.tabIndex = 0;
      host.appendChild(renderer.domElement);

      scene.add(new HemisphereLight("#ffffff", "#dde2ee", 2.1));
      const key = new DirectionalLight("#fff7df", 4.4);
      key.position.set(-5, 9, 8);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -8;
      key.shadow.camera.right = 8;
      key.shadow.camera.top = 8;
      key.shadow.camera.bottom = -5;
      scene.add(key);
      const rim = new DirectionalLight("#c8daff", 2.6);
      rim.position.set(6, 5, -6);
      scene.add(rim);

      let orbitTarget = 0;
      let pointerStart = null;
      const onPointerDown = (event) => {
        pointerStart = { id: event.pointerId, x: event.clientX, rotation: orbitTarget };
        renderer.domElement.setPointerCapture?.(event.pointerId);
      };
      const onPointerMove = (event) => {
        if (!pointerStart || event.pointerId !== pointerStart.id) return;
        orbitTarget = Math.max(-0.56, Math.min(0.56, pointerStart.rotation + (event.clientX - pointerStart.x) * 0.004));
      };
      const onPointerEnd = (event) => {
        if (pointerStart?.id !== event.pointerId) return;
        renderer.domElement.releasePointerCapture?.(event.pointerId);
        pointerStart = null;
      };
      const onKeyDown = (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        orbitTarget = Math.max(-0.56, Math.min(0.56, orbitTarget + (event.key === "ArrowLeft" ? -0.14 : 0.14)));
      };
      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("pointerup", onPointerEnd);
      renderer.domElement.addEventListener("pointercancel", onPointerEnd);
      renderer.domElement.addEventListener("keydown", onKeyDown);
      cleanUpPointerListeners = () => {
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerup", onPointerEnd);
        renderer.domElement.removeEventListener("pointercancel", onPointerEnd);
        renderer.domElement.removeEventListener("keydown", onKeyDown);
      };

      new TextureLoader().load(
        pokemon30PrizeBoxCrystalThin,
        (sourceTexture) => {
          if (!active) {
            sourceTexture.dispose();
            return;
          }
          sourceTexture.colorSpace = SRGBColorSpace;
          model = createPokemon30SealedBoosterBoxModel(sourceTexture);
          scene.add(model);
        },
        undefined,
        () => {
          if (active) setError("無法讀取你提供的獎品盒照片。");
        },
      );

      const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();

      const render = () => {
        if (model) model.rotation.y += (orbitTarget - model.rotation.y) * 0.09;
        renderer.render(scene, camera);
        frameId = window.requestAnimationFrame(render);
      };
      frameId = window.requestAnimationFrame(render);

      return () => {
        active = false;
        window.cancelAnimationFrame(frameId);
        resizeObserver?.disconnect();
        cleanUpPointerListeners();
        disposeScene(scene);
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "3D 禮盒無法啟動。");
      return () => {
        active = false;
        window.cancelAnimationFrame(frameId);
        resizeObserver?.disconnect();
        cleanUpPointerListeners();
        renderer?.dispose();
      };
    }
  }, []);

  return (
    <div className="pokemon-prize-stage" ref={hostRef}>
      {error ? <p className="pokemon-prize-stage__error">{error}</p> : null}
      <p className="pokemon-prize-stage__hint">拖曳旋轉查看</p>
    </div>
  );
}
