/**
 * Narrow-screen packet repairs. The renderer attaches this with media="screen"
 * so these rules cannot change the approved print layout or PDF pagination.
 */
export const PACKET_SCREEN_CSS = `
@media (max-width:760px){
  .band{flex-direction:column;gap:14px}
  .band > div{min-width:0;max-width:100%}
  .badge{width:100%;text-align:left}
  .urg{max-width:100%;overflow-wrap:anywhere}
  .badge .meta{overflow-wrap:anywhere}
  .strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
  .strip > div{min-width:0;border-right:0;border-bottom:1px solid var(--line)}
  .strip > div:nth-child(odd){border-right:1px solid var(--line)}
  .strip > div:last-child{grid-column:1 / -1;border:0}
  .strip .n,.strip .l{padding:0;border:0;overflow-wrap:anywhere}
}
`;
