export type TiledLayoutReason =
  | 'render'
  | 'resize'
  | 'content-scroll'
  | 'annotation-materialized'
  | 'focus-click'
  | 'focus-keyboard-vertical'
  | 'focus-keyboard-horizontal'
  | 'focus-programmatic'
  | 'annotation-click'
  | 'panel-action'
  | 'column-action';

export type TiledSectionMotion = 'immediate' | 'semantic';
export type TiledFocusedMotion = 'stable' | 'animate';
export type TiledRelationMotion = 'final-only' | 'track-transition';
export type TiledViewportLock = 'none' | 'focused-section-top';

export type TiledLayoutRefreshRequest = {
  reason?: TiledLayoutReason;
};

export type TiledLayoutTransaction = {
  reason: TiledLayoutReason;
  sectionMotion: TiledSectionMotion;
  focusedMotion: TiledFocusedMotion;
  relationMotion: TiledRelationMotion;
  viewportLock: TiledViewportLock;
};

export function resolveTiledLayoutTransaction(request: TiledLayoutRefreshRequest = {}): TiledLayoutTransaction {
  const reason = request.reason || 'focus-programmatic';
  switch (reason) {
    case 'resize':
      return transaction(reason, 'immediate', 'stable', 'final-only', 'none');

    case 'content-scroll':
      return transaction(reason, 'semantic', 'stable', 'track-transition', 'focused-section-top');

    case 'annotation-materialized':
      return transaction(reason, 'semantic', 'stable', 'track-transition', 'focused-section-top');

    case 'focus-click':
      return transaction(reason, 'semantic', 'animate', 'track-transition', 'none');

    case 'focus-keyboard-horizontal':
      return transaction(reason, 'semantic', 'animate', 'track-transition', 'none');

    case 'focus-keyboard-vertical':
      return transaction(reason, 'semantic', 'stable', 'track-transition', 'none');

    case 'annotation-click':
      return transaction(reason, 'semantic', 'stable', 'track-transition', 'none');

    case 'panel-action':
    case 'column-action':
    case 'focus-programmatic':
    case 'render':
    default:
      return transaction(reason, 'semantic', 'animate', 'track-transition', 'none');
  }
}

function transaction(
  reason: TiledLayoutReason,
  sectionMotion: TiledSectionMotion,
  focusedMotion: TiledFocusedMotion,
  relationMotion: TiledRelationMotion,
  viewportLock: TiledViewportLock,
): TiledLayoutTransaction {
  return {
    reason,
    sectionMotion,
    focusedMotion,
    relationMotion,
    viewportLock,
  };
}
