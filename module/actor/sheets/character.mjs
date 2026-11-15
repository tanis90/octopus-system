import { BRPSelectLists } from '../../apps/select-lists.mjs';
import { BRPActiveEffectSheet } from '../../sheets/brp-active-effect-sheet.mjs';
import { BRPActorSheetV2 } from "./base-actor-sheet.mjs";
import { Rules } from '../../rules/index.mjs';

export class BRPCharacterSheet extends BRPActorSheetV2 {
  constructor(options = {}) {
    super(options)
  }

  static DEFAULT_OPTIONS = {
    classes: ['character'],
    position: {
      width: 865,
      height: 850
    },
    window: {
      resizable: true,
    },
  }

  async _prepareContext(options) {
    let context = await super._prepareContext(options)
    const actorData = this.actor.toObject(false);
    context.logo = game.settings.get('brp', 'charSheetLogo');
    context.useWealth = game.settings.get('brp', 'useWealth');
    context.wealthLabel = game.settings.get('brp', 'wealthLabel');
    context.useEDU = Rules.active().settings.useEDU();
    context.useFP = game.settings.get('brp', 'useFP');
    context.useSAN = Rules.active().settings.useSAN();
    context.useRES5 = game.settings.get('brp', 'useRes5');
    context.useHPL = game.settings.get('brp', 'useHPL') && !Rules.active().wounds;
    context.useAlleg = game.settings.get('brp', 'useAlleg');
    context.usePassion = game.settings.get('brp', 'usePassion');
    context.usePersTrait = game.settings.get('brp', 'usePersTrait');
    context.useReputation = game.settings.get('brp', 'useReputation');
    context.wealthName = actorData.system.wealth
    context.wealthOptions = await BRPSelectLists.getWealthOptions(0, 4)
    if (actorData.system.wealth >= 0 && actorData.system.wealth <= 4 && actorData.system.wealth != "") {
      context.wealthName = game.i18n.localize('BRP.wealthLevel.' + actorData.system.wealth)
    }
    context.statLocked = true
    if (!actorData.system.lock && game.settings.get('brp', 'development')) { context.statLocked = false }
    context.useSocialTab = false;
    context.usePersTab = false;
    if (context.useAlleg || (context.useReputation > 0)) { context.useSocialTab = true }
    if (context.usePersTrait || context.usePassion) { context.usePersTab = true }
    context.useAVRand = game.settings.get('brp', 'useAVRand');
    context.background1 = game.settings.get('brp', 'background1');
    context.background2 = game.settings.get('brp', 'background2');
    context.background3 = game.settings.get('brp', 'background3');
    let resource = 2;
    if (game.settings.get('brp', 'useFP')) { resource++ };
    if (Rules.active().settings.useSAN()) { resource++ };
    if (game.settings.get('brp', 'useRes5')) { resource++ };
    context.resource = resource;
    context.xpFixed = "+" + game.settings.get('brp','xpFixed') +"%";
    context.xpFormula = "+" + game.settings.get('brp','xpFormula') + "%";
    // CoC settlement is always 1D10 with no fixed tier and no POW improvement;
    // the dev tab must not offer a control the ruleset ignores.
    context.growthFixed = Rules.active().growth?.allowFixedTier !== false;
    context.growthPow = Rules.active().growth?.allowPowImprovement !== false;

    //Story Section
    context.storySections = []
    if (context.system.stories instanceof Array && context.system.stories.length) {
      for (const story of context.system.stories) {
        context.storySections.push({
          title: story.title,
          value: story.value,
          enriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
            story.value,
            {
              async: true,
              secrets: context.editable
            }
          )
        })
      }
      context.storySections[0].isFirst = true
      context.storySections[context.storySections.length - 1].isLast = true
    }


    await this._prepareItems(context);
    context.rollData = context.actor.getRollData();
    //Get a List of Active Effects for the Actor
    context.effects = await BRPActiveEffectSheet.getActorEffectsFromSheet(this.document)
    context.tabs = this._getTabs(options.parts, context);
    return context
  }

  _onRender(context, _options) {
    this._dragDrop.forEach((d) => d.bind(this.element));
    this.element.querySelectorAll('.inline-edit').forEach(n => n.addEventListener("change", BRPActorSheetV2.skillInline.bind(this)))
    this.element.querySelectorAll('.addNewSection').forEach(n => n.addEventListener("click", BRPActorSheetV2.createBioSection.bind(this)))
    this.element.querySelectorAll('.move-section-up').forEach(n => n.addEventListener("click", BRPActorSheetV2.moveBioSectionUp.bind(this)))
    this.element.querySelectorAll('.move-section-down').forEach(n => n.addEventListener("click", BRPActorSheetV2.moveBioSectionDown.bind(this)))
    this.element.querySelectorAll('.delete-section').forEach(n => n.addEventListener("dblclick", BRPActorSheetV2.deleteBioSection.bind(this)))


  //Change Font Colours etc if the game settings are populated
    //Colours
    if (game.settings.get('brp', 'actorFontColour')) {
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--brp-colour-primary',game.settings.get('brp', 'actorFontColour')))
    }
    if (game.settings.get('brp', 'actorTitleColour')) {
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--brp-colour-secondary',game.settings.get('brp', 'actorTitleColour')))
    }
    if (game.settings.get('brp', 'actorTertiaryColour')) {
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--brp-colour-tertiary',game.settings.get('brp', 'actorTertiaryColour')))
    }
    if (game.settings.get('brp', 'brpIconPrimary')) {
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--brp-icon-primary',game.settings.get('brp', 'brpIconPrimary')))
    }
    if (game.settings.get('brp', 'secBackColour')) {
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--brp-labelback',game.settings.get('brp', 'secBackColour')))
    }
    if (game.settings.get('brp', 'actorRollableColour')) {
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--actor-rollable-colour',game.settings.get('brp', 'actorRollableColour')))
    }
    if (game.settings.get('brp', 'actorRollableShadowColour')) {
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--actor-rollable-shadow',game.settings.get('brp', 'actorRollableShadowColour')))
    }
    if (game.settings.get('brp', 'actorBackColour')) {
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--actor-sheet-back',game.settings.get('brp', 'actorBackColour')))
    }
    if (game.settings.get('brp', 'actorTabNameColour')) {
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--actor-tab-name-colour',game.settings.get('brp', 'actorTabNameColour')))
    }

    //Font Size - TODO need to review character sheet to see it impacts everywhere
    if (game.settings.get('brp', 'charSheetMainFontSize')) {
      let fontSize = game.settings.get('brp', 'charSheetMainFontSize')+'px'
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--actor-main-font-size',fontSize))
    }
    if (game.settings.get('brp', 'charSheetTitleFontSize')) {
      let fontSize = game.settings.get('brp', 'charSheetTitleFontSize')+'px'
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--actor-title-font-size',fontSize))
    }


    //Sheet Background
    if (game.settings.get('brp', 'actorSheetBackground')) {
      let imagePath = "url(/" + game.settings.get('brp', 'actorSheetBackground') + ")"
      document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--actor-back-img',imagePath))
    }


    //Fonts
    if (game.settings.get('brp', 'charSheetMainFont')) {
      let fontSource = "url(/" + game.settings.get('brp', 'charSheetMainFont') + ")"
      const customSheetFont = new FontFace(
        'customSheetFont',
        fontSource
      )
      customSheetFont
        .load()
        .then(function (loadedFace) {
          document.fonts.add(loadedFace)
        })
        .catch(function (error) {
          ui.notifications.error(error)
        })
        document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--actor-main-font','customSheetFont'))
    }

    if (game.settings.get('brp', 'charSheetTitleFont')) {
      let fontSource = "url(/" + game.settings.get('brp', 'charSheetTitleFont') + ")"
      const customTitleFont = new FontFace(
        'customTitleFont',
        fontSource
      )
      customTitleFont
        .load()
        .then(function (loadedFace) {
          document.fonts.add(loadedFace)
        })
        .catch(function (error) {
          ui.notifications.error(error)
        })
        document.querySelectorAll('.brp.actor').forEach(el=>el.style.setProperty('--actor-title-font','customTitleFont'))
    }

    this._syncCharacterModeToggle(this.element);
  }
}
