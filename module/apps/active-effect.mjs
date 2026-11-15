export class BRPActiveEffect extends ActiveEffect {
  // CoC7 Items have no equip-status field, so an effect transferred from an
  // Item is active exactly when the host says it is. The class stays as the
  // document-class registration seam.
}
