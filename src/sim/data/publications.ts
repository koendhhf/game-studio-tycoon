/**
 * Review outlets. Each outlet scores a game with its own bias vector over the
 * quality dimensions, so the same game legitimately earns different scores from
 * different publications — scores are derived from the game, not rolled.
 */

export interface PublicationDef {
  id: string;
  name: string;
  blurb: string;
  /** Multipliers applied to the genre's critic weights. */
  bias: {
    gameplay: number;
    graphics: number;
    story: number;
    audio: number;
    innovation: number;
    polish: number;
    bugs: number;
    hype: number;
  };
  /** Outlet reputation: higher means its score is weighted more in the aggregate. */
  authority: number;
  /** Score skew, positive = generous. */
  skew: number;
  /** Which outlets AI studios/press react to (rare, high-authority reviews move rep more). */
  influential: boolean;
}

const B = (
  gameplay: number,
  graphics: number,
  story: number,
  audio: number,
  innovation: number,
  polish: number,
  bugs: number,
  hype: number,
) => ({ gameplay, graphics, story, audio, innovation, polish, bugs, hype });

export const PUBLICATIONS: PublicationDef[] = [
  {
    id: 'bitstream',
    name: 'Bitstream',
    blurb: 'Craft-focused print magazine. Allergic to unfinished releases.',
    bias: B(1.15, 0.9, 1.1, 1.0, 1.2, 1.35, 1.4, 1.2),
    authority: 1.2,
    skew: -2,
    influential: true,
  },
  {
    id: 'polygonal',
    name: 'Polygonal',
    blurb: 'Trade weekly chasing the next commercial category winner.',
    bias: B(1.2, 1.15, 0.8, 0.9, 0.85, 1.0, 0.85, 0.7),
    authority: 1.05,
    skew: 3,
    influential: true,
  },
  {
    id: 'harddrive',
    name: 'Hard Drive Quarterly',
    blurb: 'Long-form criticism. Rewards ambition, forgives rough edges.',
    bias: B(1.0, 0.85, 1.25, 1.1, 1.45, 0.85, 0.7, 0.6),
    authority: 1.1,
    skew: -1,
    influential: true,
  },
  {
    id: 'playline',
    name: 'Playline',
    blurb: 'Consumer advice column. Judges whether the box is worth the money.',
    bias: B(1.1, 1.0, 0.9, 0.95, 0.8, 1.2, 1.3, 1.05),
    authority: 0.9,
    skew: 1,
    influential: false,
  },
  {
    id: 'arcadeedge',
    name: 'Arcade Edge',
    blurb: 'Hardcore enthusiast zine. Instantly suspicious of anything mainstream.',
    bias: B(1.25, 0.75, 0.9, 0.95, 1.3, 1.1, 1.05, 1.35),
    authority: 0.8,
    skew: -4,
    influential: false,
  },
  {
    id: 'familygamer',
    name: 'The Family Gamer',
    blurb: 'General-audience paper supplement. Presentation is everything.',
    bias: B(0.95, 1.25, 1.05, 1.05, 0.75, 1.05, 0.9, 0.5),
    authority: 0.75,
    skew: 4,
    influential: false,
  },
];

export const PUBLICATIONS_BY_ID: Record<string, PublicationDef> = Object.fromEntries(
  PUBLICATIONS.map((p) => [p.id, p]),
);
