import { Button, Screen, buttonsFrom, makeScreen, MediaInfo } from "../../src/crawler/screen.js";
import type { Observation, Transport } from "../../src/crawler/navigator.js";

export interface Node {
  text: string;
  buttons?: Array<Array<string | [string, string] | { text: string; data?: string; url?: string }>>;
  media?: MediaInfo;
  /** button text (or data) → next node id */
  go?: Record<string, string>;
  /** this screen is a placeholder; after `settle` it becomes `then` (as an edit of the same message) */
  then?: string;
  /** callback popup text on click */
  answer?: string;
}

/** A scripted bot: a graph of screens. Good enough to replay the shapes real bots show. */
export class FakeBot implements Transport {
  sent: string[] = [];
  clicks: string[] = [];
  joined: string[] = [];
  private nextId = 100;
  private pending: { id: number; node: string } | null = null;
  private byMsg = new Map<number, string>();

  constructor(private nodes: Record<string, Node>, private start: string | ((q: string) => string)) {}

  private show(nodeId: string, id?: number, edit = false): Screen {
    const n = this.nodes[nodeId];
    const msgId = id ?? this.nextId++;
    this.byMsg.set(msgId, nodeId);
    if (n.then) this.pending = { id: msgId, node: n.then };
    return makeScreen({ msgId, text: n.text, buttons: buttonsFrom(n.buttons ?? []), media: n.media, editedAt: edit ? Date.now() : undefined });
  }

  async send(text: string): Promise<Observation> {
    this.sent.push(text);
    const id = typeof this.start === "function" ? this.start(text) : this.start;
    return { screens: [this.show(id)] };
  }

  async click(screen: Screen, b: Button): Promise<Observation> {
    this.clicks.push(b.text);
    const node = this.nodes[this.byMsg.get(screen.msgId)!];
    const target = node.go?.[b.text] ?? node.go?.[b.data ?? ""];
    if (!target) return { screens: [], answer: node.answer };
    // edits happen in place unless the target is media (new message)
    const isMedia = !!this.nodes[target].media;
    return { screens: [this.show(target, isMedia ? undefined : screen.msgId, !isMedia)], answer: node.answer };
  }

  async settle(): Promise<Observation> {
    if (!this.pending) return { screens: [] };
    const p = this.pending;
    this.pending = null;
    return { screens: [this.show(p.node, p.id, true)] };
  }

  async join(target: string) {
    this.joined.push(target);
    return true;
  }
}
