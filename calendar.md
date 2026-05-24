---
layout: default
title: Calendar
eyebrow: 2026 Season
subtitle: Games and confirmed practices. Subscribe with the calendar download on the home page.
permalink: /calendar/
---

{%- capture rows -%}
{%- for g in site.data.schedule.games -%}{%- unless g.opponent == "BYE" -%}{{ g.date }}~{{ g.time }}~Game~{% if g.home %}vs {{ g.opponent }}{% else %}@ {{ g.opponent }}{% endif %}~{{ g.location }}@@{%- endunless -%}{%- endfor -%}
{%- for p in site.data.practices -%}{{ p.date }}~{{ p.start_time }}~Practice~{{ p.focus }}~{{ p.location }}@@{%- endfor -%}
{%- endcapture -%}
{%- assign list = rows | split: "@@" -%}
{%- assign sorted = list | sort -%}
{%- assign current_month = "" -%}

<p class="cal-legend">
{% for l in site.data.locations %}<span class="cal-legend__item"><span class="cal-legend__dot" style="background:{{ l.color }}"></span>{{ l.name }}</span>{% endfor %}
</p>

<div class="cal">
{% for row in sorted %}
  {%- assign parts = row | split: "~" -%}
  {%- assign d = parts[0] -%}
  {%- assign time = parts[1] -%}
  {%- assign type = parts[2] -%}
  {%- assign title = parts[3] -%}
  {%- assign loc = parts[4] -%}
  {%- assign accent = "" -%}
  {%- if type == "Practice" -%}
    {%- assign m = site.data.locations | where: "name", loc | first -%}
    {%- if m -%}{%- assign accent = m.color -%}{%- endif -%}
  {%- endif -%}
  {%- assign month = d | date: "%Y-%m" -%}
  {%- if month != current_month -%}
    {%- assign current_month = month -%}
  <h2 class="cal__month">{{ d | date: "%B %Y" }}</h2>
  {%- endif -%}
  <div class="cal-entry cal-entry--{{ type | downcase }}"{% if accent != "" %} style="border-left-color:{{ accent }}"{% endif %}>
    <div class="cal-entry__date">
      <span class="cal-entry__dow">{{ d | date: "%a" }}</span>
      <span class="cal-entry__day">{{ d | date: "%-d" }}</span>
    </div>
    <div class="cal-entry__main">
      <span class="tag tag--{{ type | downcase }}">{{ type }}</span>
      <span class="cal-entry__title">{{ title }}</span>
      <div class="cal-entry__meta">{{ time }}{% if loc != "" %} · {{ loc }}{% endif %}</div>
    </div>
  </div>
{% endfor %}
</div>

<p style="color:#6b6b6b;font-size:.85rem;margin-top:1.5rem">
  Practices are added by the coaches and appear here once confirmed.
</p>
