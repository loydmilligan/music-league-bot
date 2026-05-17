<script lang="ts">
  const { discovery = 0, themeFit = 0, nostalgia = 0, personal = 0 } = $props<{
    discovery?: number;
    themeFit?: number;
    nostalgia?: number;
    personal?: number;
  }>();

  const total = discovery + themeFit + nostalgia + personal;
  const opacities = [discovery / 5, themeFit / 5, nostalgia / 5, personal / 5];
</script>

<span class="sl-score-chip">
  <span class="bar4">
    <span class="b1" style="opacity: {opacities[0]}"></span>
    <span class="b2" style="opacity: {opacities[1]}"></span>
    <span class="b3" style="opacity: {opacities[2]}"></span>
    <span class="b4" style="opacity: {opacities[3]}"></span>
  </span>
  {total}<span class="max">/20</span>
</span>
