import { For, Show, createSignal, onCleanup, onMount, mergeProps, splitProps } from "solid-js";
import { Portal } from "solid-js/web";
import "./primitives.css";

export function Btn(raw) {
  const [props, rest] = splitProps(raw, [
    "variant",
    "htmlType",
    "disabled",
    "loading",
    "danger",
    "class",
    "children",
    "onClick",
    "ref"
  ]);
  const bp = mergeProps({ variant: "default", htmlType: "button" }, props);

  function cls() {
    const bits = ["btn-ordo"];
    if (bp.variant === "primary") {
      bits.push("btn-ordo-primary");
    }
    if (bp.variant === "text" || bp.variant === "link") {
      bits.push("btn-ordo-text");
    }
    if ((bp.variant === "text" || bp.variant === "link") && bp.danger) {
      bits.push("btn-ordo-danger-text");
    }
    if (bp.class) {
      bits.push(bp.class);
    }
    return bits.join(" ");
  }

  return (
    <button
      ref={bp.ref}
      type={bp.htmlType === "submit" ? "submit" : "button"}
      class={cls()}
      disabled={bp.disabled ?? bp.loading}
      onClick={(e) => bp.onClick?.(e)}
      {...rest}
    >
      {bp.loading ? "… " : null}
      {bp.children}
    </button>
  );
}

export function Inp(raw) {
  const [props, rest] = splitProps(raw, [
    "value",
    "onInput",
    "onChange",
    "variant",
    "class",
    "addonBefore",
    "type",
    "placeholder",
    "id",
    "aria-label",
    "min",
    "max",
    "step",
    "onBlur",
    "onKeyDown",
    "ref"
  ]);

  function cls() {
    const bits = ["inp-ordo"];
    if (props.variant === "borderless") {
      bits.push("inp-ordo-borderless");
    }
    if (props.class) {
      bits.push(props.class);
    }
    return bits.join(" ");
  }

  const relay = (ev) => {
    props.onInput?.(ev);
    props.onChange?.(ev);
  };

  return (
    <Show
      when={props.addonBefore}
      fallback={
        <input
          ref={props.ref}
          id={props.id}
          class={cls()}
          type={props.type ?? "text"}
          placeholder={props.placeholder}
          value={props.value}
          aria-label={props["aria-label"]}
          min={props.min}
          max={props.max}
          step={props.step}
          onInput={relay}
          onChange={relay}
          onBlur={props.onBlur}
          onKeyDown={props.onKeyDown}
          {...rest}
        />
      }
    >
      <span class="inp-addon-wrap">
        <span class="inp-addon-before">{props.addonBefore}</span>
        <input
          ref={props.ref}
          id={props.id}
          class={cls()}
          type={props.type ?? "text"}
          placeholder={props.placeholder}
          value={props.value}
          aria-label={props["aria-label"]}
          min={props.min}
          max={props.max}
          step={props.step}
          onInput={relay}
          onChange={relay}
          onBlur={props.onBlur}
          onKeyDown={props.onKeyDown}
          {...rest}
        />
      </span>
    </Show>
  );
}

export function TextArea(raw) {
  const [props, rest] = splitProps(raw, [
    "value",
    "onInput",
    "onChange",
    "variant",
    "class",
    "placeholder",
    "rows",
    "aria-label",
    "onBlur",
    "ref"
  ]);

  function cls() {
    const bits = ["inp-ordo"];
    if (props.variant === "borderless") {
      bits.push("inp-ordo-borderless");
    }
    if (props.class) {
      bits.push(props.class);
    }
    return bits.join(" ");
  }

  const relay = (ev) => {
    props.onInput?.(ev);
    props.onChange?.(ev);
  };

  return (
    <textarea
      ref={props.ref}
      class={cls()}
      rows={props.rows ?? 3}
      placeholder={props.placeholder}
      value={props.value}
      aria-label={props["aria-label"]}
      onInput={relay}
      onChange={relay}
      onBlur={props.onBlur}
      {...rest}
    />
  );
}

export function Sel(raw) {
  const [props, rest] = splitProps(raw, ["options", "value", "onChange", "class", "aria-label", "id"]);
  function cls() {
    return ["sel-ordo", props.class].filter(Boolean).join(" ");
  }

  return (
    <select
      id={props.id}
      class={cls()}
      value={props.value != null ? String(props.value) : ""}
      aria-label={props["aria-label"]}
      onChange={(ev) =>
        props.onChange?.((ev.target).value !== "" ? ev.target.value : "")
      }
      {...rest}
    >
      <For each={props.options || []}>{(opt) => <option value={String(opt.value)}>{opt.label}</option>}</For>
    </select>
  );
}

export function Modal(raw) {
  const [props] = splitProps(raw, ["open", "title", "onClose", "children", "footer", "wide", "class", "ariaLabel", "maskClosable"]);

  const maskClosable = () => props.maskClosable !== false;

  function onUnderlay(ev) {
    if (maskClosable() && ev.target === ev.currentTarget) {
      props.onClose?.();
    }
  }

  return (
    <Show when={props.open}>
      <Portal mount={document.body}>
        <div class="oro-modal-underlay" onClick={onUnderlay}>
          <div
            class={["oro-modal", props.wide && "oro-modal-wide", props.class].filter(Boolean).join(" ")}
            role="dialog"
            aria-label={props["ariaLabel"] ?? props.title ?? "对话框"}
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={props.title}>
              <div class="oro-modal-hd">
                <h3 class="oro-modal-hd-title">{props.title}</h3>
                <Btn variant="text" aria-label="关闭" onClick={() => props.onClose?.()}>
                  ✕
                </Btn>
              </div>
            </Show>
            <div class="oro-modal-bd">{props.children}</div>
            <Show when={props.footer}>
              <div class="oro-modal-ft">{props.footer}</div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

export function Dropdown(raw) {
  const [props] = splitProps(raw, ["items", "children"]);
  const [open, setOpen] = createSignal(false);
  let root;

  function onDoc(ev) {
    if (!open()) {
      return;
    }
    if (root && !root.contains(ev.target)) {
      setOpen(false);
    }
  }

  onMount(() => {
    const t = window.setTimeout(() => document.addEventListener("click", onDoc), 0);
    onCleanup(() => {
      window.clearTimeout(t);
      document.removeEventListener("click", onDoc);
    });
  });

  return (
    <div class="oro-dropdown-wrap" ref={root}>
      <div onClick={() => setOpen(!open())}>{props.children}</div>
      <Show when={open()}>
        <ul class="oro-dropdown-panel" role="menu">
          <For each={props.items || []}>
            {(item) => (
              <li>
                <button
                  type="button"
                  role="menuitem"
                  data-danger={item.danger ? "1" : void 0}
                  onClick={() => {
                    item.onClick?.();
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

export function Popover(raw) {
  const [props] = splitProps(raw, ["placement", "title", "content", "children"]);
  const [open, setOpen] = createSignal(false);
  let anchor;

  const flyClass = () => {
    const br = props.placement === "bottomRight" ? "pop-br" : "pop-bl";
    return ["oro-pop-flyout", br].join(" ");
  };

  function onDoc(ev) {
    if (!open()) {
      return;
    }
    if (anchor && !anchor.contains(ev.target)) {
      setOpen(false);
    }
  }

  onMount(() => {
    const t = window.setTimeout(() => document.addEventListener("click", onDoc), 0);
    onCleanup(() => {
      window.clearTimeout(t);
      document.removeEventListener("click", onDoc);
    });
  });

  return (
    <div class="oro-pop" ref={anchor}>
      <div
        role="presentation"
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen(!open());
        }}
      >
        {props.children}
      </div>
      <Show when={open()}>
        <div class={flyClass()}>
          <Show when={props.title}>
            <div class="issue-view-popover-title">{props.title}</div>
          </Show>
          {typeof props.content === "function" ? props.content() : props.content}
        </div>
      </Show>
    </div>
  );
}

export function ToggleSwitch(raw) {
  const [props] = splitProps(raw, ["checked", "onChange", "aria-label"]);

  return (
    <label class="oro-switch">
      <input
        type="checkbox"
        checked={props.checked}
        aria-label={props["aria-label"]}
        onChange={(ev) => props.onChange?.(ev.target.checked)}
      />
      <span class="oro-switch-ui" />
    </label>
  );
}

export function TagSpan(raw) {
  const [props] = splitProps(raw, ["class", "children", "color"]);
  function cls() {
    const bits = ["oro-chip"];
    if (props.color === "processing") {
      bits.push("oro-tag-processing");
    }
    if (props.color === "default") {
      bits.push("oro-tag-default");
    }
    if (props.color === "success") {
      bits.push("oro-tag-success");
    }
    if (props.class) {
      bits.push(props.class);
    }
    return bits.join(" ");
  }
  return <span class={cls()}>{props.children}</span>;
}
