//Create a default scene only after the real world collections have hydrated.
Hooks.on('brp.worldLoaded', () => {
  const isNewWorld = !(game.actors.size + game.items.size + game.journal.size);
  if (isNewWorld && game.scenes.filter(doc => doc.id !== 'NUEDEFAULTSCENE0').length === 0) {
    Scene.create({name:'Default',active:true,background:{src:'systems/brp/assets/brp-logo-powered_by-02.png'},foregroundElevation:4,thumb:'systems/brp/assets/brp-logo-powered_by-02.png',grid:{type:0},height:3000, width:3000,tokenVision:false,fog:{exploration:false},initial:{scale: 0.3868}})
  }
})
