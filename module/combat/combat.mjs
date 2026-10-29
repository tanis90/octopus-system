import { Rules } from '../rules/index.mjs'
import { BRPDamage } from './damage.mjs'

export class BRPCombat extends Combat {

  async nextRound() {
    //CoC: a dying character rolls CON at the end of every round after the
    //wound; first aid stops the checks until the next wound. Only the active GM
    //rolls and writes, so the card history has one writer and one result.
    if (Rules.active().wounds) {
      const writer = game.users?.activeGM
      if (writer && game.user?.id === writer.id) {
        for (const combatant of this.combatants ?? []) {
          const actor = combatant.actor
          const wounds = actor?.flags?.brp?.coc?.wounds
          if (wounds?.dying === true && wounds?.stabilized !== true && wounds?.dead !== true) {
            await BRPDamage.cocDyingRound(actor, { reason: 'end-of-round' })
          }
        }
      }
    }
    if (game.settings.get('brp', 'initRound') !== 'no') {
      await this.resetAll();
    }
    if (game.settings.get('brp', 'initRound') === 'auto') {
      await this.rollAll();
      await this.setupTurns();
    }
    super.nextRound()
  }

}
