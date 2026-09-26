Simulation (Economic Policy):

- Frontend: Sim City/Pokemon Game Pixel Art Design, NPC walking around talking, building represented as organization talking, house represented as families talking  
  - Talking -> Chat Bubbles  
  - Animation of multiple ppl walking in streets, protest/riot? Good for showcase demo coz chat bubbles can be boring	  
  - Use [pixellab.ai](http://pixellab.ai) for pixel art generation  
  - [Optional] Social Graph showing detailed NPCs relations (Backend Side)  
- Backend:  
  - Simplified Mirofish ([https://github.com/666ghj/MiroFish](https://github.com/666ghj/MiroFish))  
  - [Optional] LLM with web_search tool  
- Flow:  
  - Prompt 500 words of policy implementation, and we simulate (inspired by Mirofish) how the policy cascades to everydays life, from ppl reaction, to price changes etc etc.  
    - Note: Implement graph rag later on for attaching economy policies

Architecture

- Specs  
  - Lead orchestrator to communicate with all agents  
  - Some type of social graph needed for like friendship levels  
  - Individual Agents are able to communicate with each other  
    - This would be designed based on like human interactions  
  - Core Agent Flow: Perceive → React → Act  
  - 

- Extract entities, people, events from documents / prompt   
- Create detailed personas for each entity with attributes, relationships, and background context  
- Tech Stack:  
  - Frontend: Phaser, Next JS, bun  
  - Backend: fastapi, Langgraph, K2 Think, 
