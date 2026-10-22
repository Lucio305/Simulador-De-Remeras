// Paso: Tu remera terminada (implementación provisoria)
export default {
  id: 'final',
  title: 'Tu remera terminada',
  short: 'Final',
  icon: '🏆',
  scored: false,
  help: '',
  defaults(state) {},
  async enter(ctx) {
    ctx.placeShirt('exhibicion');
    ctx.flyTo(ctx.stations.exhibicion.view);
    ctx.ui.panel({
      kicker: 'Paso',
      title: this.title,
      subtitle: 'En construcción.',
      actions: [{ id: 'next', label: 'Continuar →', kind: 'primary', onClick: () => ctx.next() }],
    });
  },
};
