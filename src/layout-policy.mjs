/** Geometry policy shared by canvas UI, bridge and business layout planners.
 * Body bounds exclude labels/toolbars; these gaps reserve room at normal zoom.
 * Business regions/order remain the planner's responsibility.
 */
export const LAYOUT_POLICY = Object.freeze({
  version: 1,
  nodeGapX: 160,
  nodeGapY: 96,
  groupGapX: 200,
  groupGapY: 160,
  groupPadding: 56,
  fitFrames: false,
  boundsKind: 'body',
})
