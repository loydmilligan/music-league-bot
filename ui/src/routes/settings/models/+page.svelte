<script lang="ts">
  import SettingsTabs from '$lib/components/SettingsTabs.svelte';
  import ModelsScreen from '$lib/models/ModelsScreen.svelte';
</script>

<svelte:head><title>Models & AI · music-league-bot</title></svelte:head>

<div style="display: flex; flex-direction: column; gap: 24px;">
  <header style="display: flex; flex-direction: column; gap: 6px;">
    <p style="font: 700 10px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-muted); margin: 0;">
      music-league-bot · /settings/models
    </p>
    <h1 style="margin: 0; font: 700 28px/1.15 var(--font-display); letter-spacing: -0.015em; color: var(--fg);">
      Models & AI
    </h1>
  </header>

  <SettingsTabs />

  <ModelsScreen />
</div>
