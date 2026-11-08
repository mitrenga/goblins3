<?php

require_once 'app/svision/php/abstractAboutPage.php';

/**
 * The /about page: the story of the original Goblins Quest 3 and this remake,
 * with links to Wikipedia, MobyGames and Retro Games.
 *
 * Working draft (2026-09-15): the remake is not finished, and the text says
 * so. Rewrite the "This remake" section when the game is playable to the end.
 */
class AboutPage extends AbstractAboutPage {

  protected function aboutData() {
    return [
      'image' => 'images/cover.png',
      'sections' => [
        [
          'heading' => 'The original game (1993)',
          'html' =>
            '<p>Goblins Quest 3 — <em>Goblins 3</em> in Europe — is the third and last of the Gobliiins '.
            'adventure games by the French studio Coktel Vision, designed by Pierre Gilhodes and Muriel '.
            'Tramis and released for MS-DOS in 1993; Sierra On-Line published it in the United States '.
            'a year later. Where the first game had three goblins and the second two, this one has '.
            'just one: Blount, a goblin journalist sent to report on the war between two kingdoms, '.
            'who falls in love with the princess Wynnona, gets bitten by a werewolf and picks up '.
            'a string of odd companions along the way — a parrot, a snake, a dragon.</p>'.
            '<p>It is a point-and-click puzzle game with the series\' trademark cartoon slapstick: '.
            'every screen is a self-contained puzzle, every object can be tried on everything, and '.
            'most of the wrong answers are funnier than the right one. Unlike its predecessors it has '.
            'no energy bar and no passwords — nobody dies, and the game is saved by name.</p>',
        ],
        [
          'heading' => 'This remake',
          'html' =>
            '<p>This is a faithful remake that runs directly in your web browser — nothing to install, '.
            'nothing to download, free of charge. It is not a port: the game\'s own scripts from the '.
            'original floppy release are run through an interpreter written for the browser, and '.
            'everything you see and hear — every picture, palette, font and sound — is the original '.
            'data drawn on an emulated VGA screen at 320&times;200 in 256 colours.</p>'.$this->installNote().
            '<p><strong>Work in progress.</strong> The intro plays, the first rooms open and Blount '.
            'walks where you click, but the game cannot yet be played through. Come back later.</p>',
        ],
        [
          'heading' => 'Other games',
          'html' =>
            '<p>This remake is one of a growing collection of classic games from the 8-bit and 16-bit era '.
            '— ZX Spectrum, Commodore 64, arcade and more — rebuilt faithfully on the same library and '.
            'playable in your browser, free of charge. Browse the whole collection at '.
            '<a href="https://retrogames.free/" target="_blank" rel="noopener">retrogames.free</a>.</p>',
        ],
      ],
      'links' => [
        ['label' => 'Goblins Quest 3 on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/Goblins_Quest_3'],
        ['label' => 'Gobliiins series on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/Gobliiins'],
        ['label' => 'Goblins Quest 3 on MobyGames', 'url' => 'https://www.mobygames.com/game/1184/goblins-quest-3/'],
        ['label' => 'Coktel Vision on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/Coktel_Vision'],
      ],
      'footer' =>
        '<p>An unofficial fan remake. The original game and its artwork belong to their authors. '.
        'The engine behaviour follows the documentation of the ScummVM project\'s <em>gob</em> engine. '.
        'The remake\'s source code is licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>.</p>',
    ];
  } // aboutData

} // AboutPage
