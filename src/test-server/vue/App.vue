<template>
  <h1>Hello, Vue!</h1>
  <ul>
    <li v-for="item in items">
        {{ item }}
    </li>
  </ul>
</template>

<script setup>
import { onMounted, nextTick } from 'vue';

const items = Array.from({ length: 10 }, (x, i) => i);

onMounted(() => {
    nextTick(() => {
        window.dispatchEvent(new Event('renderDoneEvent'));
    });
});
</script>

<style>
h1 {
    color: crimson;
}
li {
    color: darkslateblue;
}
</style>
