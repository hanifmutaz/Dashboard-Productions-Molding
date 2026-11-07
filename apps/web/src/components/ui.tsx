import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';

/* ---------- toast (status, aria-live) ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    setN((x) => x + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={`toast${msg ? ' show' : ''}`} role="status" aria-live="polite" key={n}>
        <i />
        <span>{msg}</span>
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- tooltip: pointer (mouse) only; never sticks on touch (NFR-UI) ---------- */
export interface TipContent { title: string; rows?: { label: ReactNode; value: ReactNode; color?: string }[]; extra?: ReactNode }
const TipCtx = createContext<{ show: (e: { clientX: number; clientY: number; pointerType?: string }, c: TipContent) => void; hide: () => void }>({ show: () => undefined, hide: () => undefined });
export function TipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ x: number; y: number; c: TipContent } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!tip || !ref.current) return;
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    let x = tip.x + 14, y = tip.y + 14;
    if (x + w > innerWidth - 8) x = tip.x - w - 14;
    if (y + h > innerHeight - 8) y = tip.y - h - 14;
    setPos({ left: x, top: y });
  }, [tip]);
  const show = useCallback((e: { clientX: number; clientY: number; pointerType?: string }, c: TipContent) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    setTip({ x: e.clientX, y: e.clientY, c });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return (
    <TipCtx.Provider value={{ show, hide }}>
      {children}
      <div className={`tip${tip ? ' show' : ''}`} ref={ref} style={pos} aria-hidden="true">
        {tip && (
          <>
            <div className="tt">{tip.c.title}</div>
            {tip.c.rows?.map((r, i) => (
              <div className="r" key={i}>
                <span>{r.color && <i style={{ background: r.color }} />}{r.label}</span>{r.value}
              </div>
            ))}
            {tip.c.extra}
          </>
        )}
      </div>
    </TipCtx.Provider>
  );
}
export const useTip = () => useContext(TipCtx);
/** Props for any element that shows a hover tip with mouse; touch users get the same data inline/elsewhere. */
export function useTipProps(c: TipContent | null) {
  const { show, hide } = useTip();
  if (!c) return {};
  return { onPointerMove: (e: PointerEvent) => show(e, c), onPointerLeave: hide };
}

/* ---------- menu (Radix behaviour only, mockup visuals) ---------- */
export function Menu({ label, children, align = 'end' }: { label: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger asChild>
        <button className="btn" type="button">{label}</button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="ml open" align={align} sideOffset={4} style={{ position: 'static' }}>
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export const MenuItem = ({ onSelect, children }: { onSelect: () => void; children: ReactNode }) => (
  <Dropdown.Item asChild onSelect={onSelect}>
    <button type="button">{children}</button>
  </Dropdown.Item>
);
export function MenuCheck({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <Dropdown.CheckboxItem asChild checked={checked} onCheckedChange={(v) => onChange(v === true)} onSelect={(e) => e.preventDefault()}>
      <label>
        <input type="checkbox" checked={checked} readOnly tabIndex={-1} /> {children}
      </label>
    </Dropdown.CheckboxItem>
  );
}

/* ---------- modal (Radix focus trap + Esc) ---------- */
export function Modal({ open, onClose, title, sub, children }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="mbg open">
          <Dialog.Content className="modal" aria-describedby={undefined}>
            <div className="ch" style={{ paddingBottom: 'var(--s-size-12)', borderBottom: 'var(--s-size-1) solid var(--line)' }}>
              <div>
                <Dialog.Title asChild><h3>{title}</h3></Dialog.Title>
                {sub && <p>{sub}</p>}
              </div>
              <Dialog.Close asChild><button className="btn" type="button">Close</button></Dialog.Close>
            </div>
            <div className="cb">{children}</div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ---------- toggle switch ---------- */
export function Toggle({ on, onChange, children, style, disabled }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; style?: CSSProperties; disabled?: boolean }) {
  const toggle = () => !disabled && onChange(!on);
  return (
    <span className={`tog${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-disabled={disabled} tabIndex={0} style={style} onClick={toggle}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}>
      <span className="swt" />
      {children}
    </span>
  );
}

/* ---------- tabs (underline tabs, arrow-key navigation) ---------- */
export function Tabs<T extends string>({ items, value, onChange, right }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; right?: ReactNode }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = items.findIndex((x) => x.id === value);
    const n = items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length];
    if (n) onChange(n.id);
  };
  return (
    <div className="tabsrow">
      <div className="tabs" role="tablist" onKeyDown={onKey}>
        {items.map((t) => (
          <button key={t.id} type="button" role="tab" className={`tab${t.id === value ? ' on' : ''}`} aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {right}
    </div>
  );
}

export const Seg = <T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) => (
  <span className="seg" role="group">
    {items.map((x) => (
      <button key={x.id} type="button" className={x.id === value ? 'on' : ''} aria-pressed={x.id === value} onClick={() => onChange(x.id)}>{x.label}</button>
    ))}
  </span>
);
