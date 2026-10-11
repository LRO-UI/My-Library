// Sample content shown on first launch. Public-domain excerpts.
export const SEED_BOOKS = [
  { id: 'b1', title: 'Pride and Prejudice', author: 'Jane Austen', color: '#E8605C', tags: ['Romance'], image: '', showText: true, chapter: 0,
    chapters: [
      { title: 'Chapter I', paras: [
        'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
        'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.',
        '“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”',
        'Mr. Bennet replied that he had not.'] },
      { title: 'Chapter II', paras: ['Mr. Bennet was among the earliest of those who waited on Mr. Bingley.'] },
    ] },
  { id: 'b2', title: 'Moby-Dick', author: 'Herman Melville', color: '#46668F', tags: ['Adventure'], image: '', showText: true, chapter: 0,
    chapters: [{ title: 'Loomings', paras: ['Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.'] }] },
];

// Sample CDs have placeholder running times and no audio files.
// Tapping one opens the editor so an audio file can be attached.
export const SEED_AUDIO = [
  { id: 'a1', title: 'The Odyssey', author: 'Homer', color: '#8C7BC4', tags: ['Adventure'], image: '', showText: true, tracks: [], len: 43200, pos: 15600 },
  { id: 'a2', title: 'Dracula', author: 'Bram Stoker', color: '#3E8A8C', tags: ['Gothic'], image: '', showText: true, tracks: [], len: 55800, pos: 36600 },
];

// Samples from earlier versions. Installs that still have them untouched get them removed.
export const RETIRED_SEEDS = ['b3', 'b4', 'b5', 'b6', 'a3', 'a4', 'a5'];

// Starter tags. Users can add their own and delete any of these.
export const SEED_TAGS = [
  { name: 'Romance', color: '#E8605C' },
  { name: 'Adventure', color: '#46668F' },
  { name: 'Classic', color: '#8A6A5A' },
  { name: 'Fantasy', color: '#8C7BC4' },
  { name: 'Gothic', color: '#3E8A8C' },
];
