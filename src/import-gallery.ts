import { t, uiText, uiAttr } from "../shared/i18n.js";
import { photoStatus } from "./photo-status";
import type { Photo } from "./types";
import { processImage } from "./processor";
export function setupImportGallery(
  getPhotos: () => Photo[],
  isBusy: () => boolean,
  review: (id: string) => void,
  setExcluded: (id: string, excluded: boolean) => void,
) {
  const root = document.getElementById("importGallery")!,
    grid = document.getElementById("importGalleryGrid")!,
    count = document.getElementById("importGalleryCount")!;
  const dialog = document.getElementById("photoViewer") as HTMLDialogElement,
    image = document.getElementById("galleryImage") as HTMLImageElement;
  const title = document.getElementById("galleryTitle")!,
    status = document.getElementById("galleryStatus")!;
  const previous = document.getElementById(
      "galleryPrevious",
    ) as HTMLButtonElement,
    next = document.getElementById("galleryNext") as HTMLButtonElement,
    go = document.getElementById("galleryReview") as HTMLButtonElement;
  const cards = new Map<
    string,
    {
      root: HTMLElement;
      remove: HTMLButtonElement;
      button: HTMLButtonElement;
      image: HTMLImageElement;
      title: HTMLElement;
      status: HTMLElement;
    }
  >();
  const toggle = document.getElementById("galleryToggle")!,
    content = document.getElementById("importGalleryContent")!;
  const renderToggle = () => {
    toggle.setAttribute("aria-expanded", String(!content.hidden));
    uiText(toggle, () => (content.hidden ? t("展开照片墙") : t("收起照片墙")));
  };
  toggle.onclick = () => {
    content.hidden = !content.hidden;
    renderToggle();
  };
  let selected = "",
    trigger: HTMLElement | undefined,
    generation = 0,
    activeId = "",
    activeSource = "",
    activeRotation = -1,
    ownedUrl = "";
  const showRemoved = document.getElementById(
    "galleryShowRemoved",
  ) as HTMLInputElement;
  const removedTools = document.getElementById("galleryRemovedTools")!;
  const undo = document.getElementById(
    "galleryUndoRemove",
  ) as HTMLButtonElement;
  const removalStatus = document.getElementById("galleryRemovalStatus")!;
  const removeSelected = document.getElementById(
    "galleryRemove",
  ) as HTMLButtonElement;
  let lastRemoved = "";
  const visiblePhotos = () =>
    getPhotos().filter((p) => showRemoved.checked || !p.excluded);
  function changeExclusion(id: string, excluded: boolean) {
    if (isBusy()) return;
    const photo = getPhotos().find((p) => p.id === id);
    if (!photo) return;
    if (dialog.open) dialog.close();
    lastRemoved = excluded ? id : "";
    uiText(removalStatus, () =>
      t(
        excluded
          ? "已移除：{0}。原图保留，可撤销或显示已移除照片恢复。"
          : "已恢复：{0}。",
        photo.name,
      ),
    );
    setExcluded(id, excluded);
    render();
    if (excluded) undo.focus();
    else cards.get(id)?.button.focus();
  }
  undo.onclick = () => {
    if (lastRemoved) changeExclusion(lastRemoved, false);
  };
  showRemoved.onchange = () => render();
  removeSelected.onclick = () => {
    const photo = getPhotos().find((p) => p.id === selected);
    if (photo) changeExclusion(photo.id, !photo.excluded);
  };
  const state = (p: Photo) => t(photoStatus(p));
  const clearImage = () => {
    image.hidden = true;
    image.removeAttribute("src");
    if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    ownedUrl = "";
  };
  async function display() {
    if (!dialog.open) return;
    const photos = visiblePhotos(),
      index = photos.findIndex((p) => p.id === selected),
      p = photos[index];
    if (!p) {
      dialog.close();
      return;
    }
    uiText(title, () =>
      t(
        "第 {0} / {1} 张 · {2}",
        getPhotos().indexOf(p) + 1,
        getPhotos().length,
        p.name,
      ),
    );
    previous.disabled = index <= 0;
    next.disabled = index >= photos.length - 1;
    go.disabled = isBusy() || !p.file;
    removeSelected.disabled = isBusy();
    uiText(removeSelected, () => t(p.excluded ? "恢复照片" : "移除照片"));
    uiText(status, () => state(p));
    const source = p.thumb || "";
    if (
      activeId === p.id &&
      activeSource === source &&
      activeRotation === p.rotation &&
      image.getAttribute("src")
    )
      return;
    activeId = p.id;
    activeSource = source;
    activeRotation = p.rotation;
    const token = ++generation;
    image.setAttribute("aria-busy", "true");
    uiText(status, () => t("正在载入原图…"));
    try {
      let url = source,
        owned = false;
      // Thumbnails are always unwarped originals. A missing HEIC thumbnail can
      // be decoded locally without changing Photo or borrowing corrected output.
      if (!url && p.file) {
        const r = await processImage({
          blob: p.file,
          rotation: p.rotation,
          corners: [],
          maxEdge: 1800,
          brightness: 0,
          contrast: 0,
          kind: "plain",
        });
        url = URL.createObjectURL(r.blob);
        owned = true;
      }
      if (!url) throw Error("原图缺失");
      const preload = new Image();
      preload.src = url;
      try {
        await preload.decode();
      } catch (error) {
        if (owned) URL.revokeObjectURL(url);
        throw error;
      }
      if (token !== generation || !dialog.open) {
        if (owned) URL.revokeObjectURL(url);
        return;
      }
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      ownedUrl = owned ? url : "";
      image.src = url;
      image.hidden = false;
      uiAttr(image, "alt", () => p.name);
      uiText(status, () => state(p));
    } catch {
      if (token !== generation) return;
      clearImage();
      uiText(status, () =>
        p.file ? t("原图预览失败，可前往核对重试。") : t("原图缺失"),
      );
      activeSource = "";
      activeRotation = -1;
    } finally {
      if (token === generation) image.removeAttribute("aria-busy");
    }
  }
  function open(id: string, button: HTMLElement) {
    selected = id;
    trigger = button;
    dialog.showModal();
    void display();
  }
  const move = (delta: number) => {
    const photos = visiblePhotos(),
      index = photos.findIndex((p) => p.id === selected);
    if (photos[index + delta]) {
      selected = photos[index + delta].id;
      void display();
    }
  };
  previous.onclick = () => move(-1);
  next.onclick = () => move(1);
  document.getElementById("galleryClose")!.onclick = () => dialog.close();
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
  });
  dialog.addEventListener("close", () => {
    generation++;
    activeId = "";
    activeSource = "";
    activeRotation = -1;
    clearImage();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  });
  go.onclick = () => {
    if (isBusy()) return;
    const id = selected;
    dialog.close();
    review(id);
  };
  function render() {
    renderToggle();
    const allPhotos = getPhotos();
    const photos = visiblePhotos();
    root.hidden = !allPhotos.length;
    document.getElementById("galleryEmpty")!.hidden = !!photos.length;
    const removed = allPhotos.filter((p) => p.excluded).length;
    removedTools.hidden = !removed;
    undo.hidden =
      !lastRemoved ||
      !allPhotos.some((p) => p.id === lastRemoved && p.excluded);
    undo.disabled = isBusy();
    uiText(count, () =>
      removed
        ? t("共 {0} 张 · 已移除 {1} 张", allPhotos.length, removed)
        : t("共 {0} 张 · 按当前页序展示", photos.length),
    );
    const ids = new Set(photos.map((p) => p.id));
    for (const [id, card] of cards)
      if (!ids.has(id)) {
        card.root.remove();
        cards.delete(id);
      }
    photos.forEach((p, index) => {
      let card = cards.get(p.id);
      if (!card) {
        const wrapper = document.createElement("div");
        wrapper.className = "gallery-item";
        const remove = document.createElement("button");
        remove.className = "gallery-remove quiet";
        remove.type = "button";
        remove.dataset.galleryControl = "";
        remove.onclick = () => changeExclusion(p.id, !p.excluded);
        const button = document.createElement("button"),
          img = document.createElement("img"),
          title = document.createElement("span"),
          status = document.createElement("small");
        button.type = "button";
        button.className = "gallery-card";
        button.dataset.galleryControl = "";
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        button.append(img, title, status);
        button.onclick = () => open(p.id, button);
        wrapper.append(button, remove);
        card = { root: wrapper, remove, button, image: img, title, status };
        cards.set(p.id, card);
      }
      const source = p.thumb || "";
      if (source && card.image.getAttribute("src") !== source) {
        card.image.src = source;
        card.image.style.visibility = "visible";
      } else if (!source) {
        card.image.removeAttribute("src");
        card.image.style.visibility = "hidden";
      }
      const pageNumber = allPhotos.indexOf(p) + 1;
      card.remove.disabled = isBusy();
      uiText(card.remove, () => t(p.excluded ? "恢复照片" : "移除照片"));
      uiAttr(card.remove, "aria-label", () =>
        t(p.excluded ? "恢复照片：{0}" : "移除照片：{0}", p.name),
      );
      uiText(card.title, () => `${pageNumber}. ${p.name}`);
      uiText(card.status, () => state(p));
      uiAttr(card.button, "aria-label", () =>
        t("查看第 {0} 张原图：{1}", pageNumber, p.name),
      );
      const current = grid.children[index];
      if (current !== card.root) grid.insertBefore(card.root, current || null);
    });
    if (dialog.open) void display();
  }
  return Object.assign(render, { isOpen: () => dialog.open });
}
